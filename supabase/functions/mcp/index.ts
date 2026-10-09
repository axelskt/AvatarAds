import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { isBlockedHost as guardBlockedHost, hostResolvesInternal, rateHit, realIp, hedraStatusGate, providerPause, retryAfterS } from '../_shared/guard.ts'   // audit #3 + round3 (DNS interne) + throttle /register
import { STATIC_AD_FORMATS, fillStaticAdTemplate, pickStaticAdFormat, STATIC_AD_COMMON, type StaticAdFormat } from './static-ads-bank.ts'
import { KIE, kieKey, kieHeaders, kieRecord, kieDownload, kieKindOf, kieClientsOn, kieVeoClientsOn } from '../_shared/kie.ts'   // + Motion Control via kie.ai (Axel 09/10, sans repli fal)   // Veo Lite / Fast via kie.ai (Axel 25/09)
import { nettoyerVoix, nettoyageDisponible, nettoyerEtLivrer, nettoyerAvantMontage, type ConfigNettoyage } from './nettoyage-voix.ts'
import { preparerWavHedra, couperMp4, opAvecCoupe, coupeDeOp, jobSansCoupe, mesurerAudio, preparerMp3Lipsync, dureeAudioAutres } from '../_shared/lipsync-audio.ts'   // 26/09 : dernier mot articulé + durée MESURÉE (relecture) ; audit 04/10 (MCP-4) : FLAC / Opus / AAC mesurés
import { dureeMp4Octets } from '../_shared/mp4-duree.ts'   // Audit 02/10 : durée MESURÉE des M4A / MP4 (clean_audio, montage_ia)
import { expressOmniPrompt, expressVeoPrompt, expressImagePrompt, IMG_REALISM_SUFFIX, IMG_REALISM_EDIT, IMG_TEXT_FIDELITY, NB_MODEL, omniEditPrompt, motionControlPrompt } from '../_shared/express-prompts.ts'   // 01/10 : prompts Express (Omni Flash + Veo, français seul) IDENTIQUES à l'app (généré depuis app/index.html : node tools/gen-express-prompts.mjs)
import { HEDRA_PROMPT, HEDRA_SLUG_DEFAUT } from '../_shared/hedra-prompts.ts'   // 27/09 : Character-3 + prompt validé de l'usine, PARTAGÉ app / MCP / worker (shared/hedra-prompts.json)
import { KIE_OMNI_STALE_MIN, OP_KIE_OMNI, omniKieOn, estOmniKie, taskDeOp, promptOmniMcp, soumettreOmniKie, avancerOmniKie } from './omnihuman-kie.ts'   // OmniHuman → kie (Axel 25/09)
import { cheminSur, clePrepMcp, controlerTaillePlan, nettoyerSonUtilisateur } from '../_shared/storage-path.ts'   // audit 02/10 : chemins render-media et plans de rendu
// ImageScript : décodeur/redimensionneur PNG-JPEG en WASM. Indispensable ici —
// le chef d'orchestre REFUSE les miniatures au-dessus de 400 Ko, et une photo
// d'utilisateur en pèse 2 à 3. Sans réduction, il reçoit le nom du média mais
// jamais l'image : il ne le place donc pas (vu le 31/07, broll vide).
// ⚡ COLD-START (01/09) : chargé en import DYNAMIQUE là où on l'utilise (fabriquerApercu /
// reframeToAspect / miniature), PAS au module-init. Le WASM ne pèse plus sur le démarrage à
// froid → les appels d'outils (generate_*) répondent vite même sur un isolate froid. (La
// connexion — initialize/tools/list — est servie à l'edge Netlify, donc la fonction n'est plus
// réveillée que pour les vrais appels : son démarrage doit être le plus léger possible.)
const loadImage = () => import('https://deno.land/x/imagescript@1.3.0/mod.ts').then(m => m.Image)

// ── Serveur MCP AvatarAds ↔ Claude (#73) ──
// Protocole MCP « Streamable HTTP » (JSON-RPC sur POST, réponses JSON, sans état).
// Compatible connecteurs personnalisés claude.ai et `claude mcp add --transport http`.
//
//   POST /mcp/key            (JWT utilisateur)  → gérer sa clé : status / create / revoke / set_confirm
//   POST /mcp/aa_<clé>       (clé personnelle)  → endpoint MCP (initialize, tools/list, tools/call)
//
// La clé est dans l'URL (pattern Zapier) : c'est la seule forme que les connecteurs
// claude.ai acceptent sans OAuth. Stockée hachée (HMAC service key), jamais en clair.
// Génération : gpt-image-2/1 (images) et Veo 3.1 (vidéos, job asynchrone start/poll). Veo 3.1 Lite (Standard) et Fast
// (Pro) passent chez kie.ai pour TOUS les clients depuis le 25/09 (décision d'Axel), Google direct en REPLI seulement
// quand kie refuse la soumission (aucune tâche créée) — voir « VEO VIA KIE.AI » plus bas.
// Crédits : mêmes tarifs que l'app, débit via les RPC service-only mcp_spend_credits
// / mcp_refund_credits (barème #79 : image 3 ou 5, vidéo 1/s).

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''   // x-cron-key du cron mcp-keepwarm (réconciliation globale, audit 28/09)
// ── L'URL QU'ON DONNE À L'UTILISATEUR NE PEUT PAS ÊTRE CELLE DE SUPABASE ──
// Claude sonde l'emplacement RFC 9728 pour savoir si la ressource est protégée :
//   https://<hôte>/.well-known/oauth-protected-resource/<chemin>
// Sur supabase.co, c'est la PASSERELLE Supabase qui répond (jamais l'edge
// function) et elle renvoie 401 « No API key found in request ». Un 401 là-bas
// signifie « OAuth » : Claude enchaîne sur l'inscription dynamique du client,
// qu'on n'a pas, et échoue — « Impossible de s'inscrire auprès du service de
// connexion de AvatarAds ». Rien dans ce fichier ne peut corriger ça : la
// requête ne l'atteint jamais.
// On distribue donc l'adresse du relais (mcp-proxy/), servi depuis un domaine
// où l'on maîtrise /.well-known/* et où il répond 404 = « pas d'OAuth ».
const MCP_PUBLIC_BASE = 'https://mcp.avatarads.fr'   // 20/08 : domaine de marque (ex avatarads-mcp.netlify.app, toujours accepté)
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const GOOGLE_AI_KEY  = Deno.env.get('GOOGLE_AI_KEY') ?? ''
const HEDRA_API_KEY  = Deno.env.get('HEDRA_API_KEY') ?? ''
const ELEVEN_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? ''

const APP_URL         = 'https://avatarads.fr/app/'
// Page de consentement OAuth DÉDIÉE + instantanée (01/09) — voir mcp-consent.html. Le /authorize y
// redirige au lieu de l'app lourde : la carte s'affiche en < 0,5 s → Claude ne relance pas un 2ᵉ
// /authorize → plus de code périmé → token fiable à tous les coups.
const CONSENT_URL     = 'https://avatarads.fr/mcp-consent.html'
// Qualités (Axel 02/10, mêmes paliers que l'app) : low = « Standard » éco (gpt low, 1 cr) · standard = « Premium » (gpt medium,
// 3 cr, DÉFAUT) · high = « Haute qualité » (gpt high, 5 cr). On ne quitte Premium QUE si l'utilisateur le demande.
const IMG_COST        = { low: 1, standard: 3, high: 5 }
type ImgQ = 'low' | 'standard' | 'high'
const qualiteImage = (v: unknown): ImgQ => { const q = String(v || '').toLowerCase(); return /^(high|haute|hd|4k|max)/.test(q) ? 'high' : /^(standard|eco|éco|low|basse)/.test(q) ? 'low' : 'standard' }
const VIDEO_COST_SEC  = 1.5 // Veo 3.1 Lite 720p (« Veo Standard ») = 0,05 $/s API (audio inclus)
const VIDEO_COST_SEC_PRO = 3 // Veo 3.1 Fast (« Veo Pro », qualité max) = 0,10 $/s API — modèle au choix
// ── Générateur (avatar parlant) via Claude : mêmes briques que l'app ──
const HEDRA_BASE      = 'https://api.hedra.com/web-app/public'
const HEDRA_MODEL_ID  = '26f0fc66-152b-40ab-abed-76c43df99bc8' // Hedra Avatar (swap 10/08, même modèle que l'app). Character-3 = d1dd37a3-e39a-4854-a298-6510289f9cf2
// ── Hedra v3 (clé dev) : l'ancienne API web-app/public est MORTE (upload /assets échoue). Le lipsync
//    passe désormais par /v3/files → /v3/models/<slug> → /v3/jobs, EXACTEMENT comme le render-worker. ──
const HEDRA_V3_KEY    = Deno.env.get('HEDRA_V3_KEY') ?? ''
const HEDRA_V3_BASE   = 'https://api.hedra.com'
const HEDRA_V3_SLUG   = Deno.env.get('HEDRA_SLUG') ?? HEDRA_SLUG_DEFAUT   // 27/09 (Axel) : Character-3 partout (était hedra-avatar)
// Prompt lipsync Hedra. Axel 27/09 : « Character-3 fait très bien le taff, on l'a câblé parfaitement avec le prompt » →
// le prompt VALIDÉ sur les hooks de l'usine (« TOP PRIORITY lip-sync » + les deux mains dès le début), pronoms neutres,
// source unique shared/hedra-prompts.json (node tools/gen-hedra-prompts.mjs). OmniHuman garde son prompt court (kie ≤ 300).
const AVATAR_PROMPT   = HEDRA_PROMPT
const AVATAR_COST_SEC = 2.5 // 2 cr/s lipsync Hedra (1080p, barème 23/08) + 0,5 cr/s voix ElevenLabs
const LIPSYNC_COST_SEC = 2  // lipsync_video Hedra (1080p) : 2 cr/s comme l'app, le worker et hedra-proxy (« 2 cr/s partout », Axel 23/08) — était resté à 1
const AVATAR_MAX_SEC  = 60
const CHARS_PER_SEC   = 14  // débit de parole FR moyen pour estimer la durée depuis le script
// Voix presets (mêmes IDs ElevenLabs que l'app)
const MCP_VOICES: Record<string, string> = {
  homme: 'onwK4e9ZLuTAKqWW03F9',  // Daniel — posé, confiant
  femme: 'XB0fDUnXU5powFXDhCwa',  // Charlotte — chaleureuse, naturelle
}
// Nettoyage audio : ~1 crédit / minute d'audio. Depuis le 25/09 il tourne sur NOTRE serveur de
// rendu (render-worker, route /audio/clean : RNNoise + chaîne voix de l'app, 0 €/min) ; ElevenLabs
// Voice Isolator ne sert plus que de secours (voir nettoyage-voix.ts).
const CLEAN_COST_PER_MIN = 1
const CLEAN_MAX_BYTES    = 15_000_000 // ~15 min de MP3 128 kbps
const NETTOYAGE: ConfigNettoyage = {
  workerUrl: Deno.env.get('AUDIO_CLEAN_URL') ?? '',   // domaine public Railway du render-worker
  workerKey: Deno.env.get('AUDIO_CLEAN_KEY') ?? '',   // même secret que la variable Railway AUDIO_CLEAN_KEY
  elevenKey: ELEVEN_API_KEY,                          // secours
}
// Montage IA via Claude (#125) : chef d'orchestre + rendu serveur (mêmes tarifs que l'app)
// ⚠️ CE QUI DOIT CORRESPONDRE À L'APP, C'EST LE TOTAL, PAS LE DÉTAIL.
// Un montage complet coûte 8 crédits ici comme dans l'app (CREDIT_COSTS.montageIA),
// et un re-rendu de plan modifié en coûte 4 (CREDIT_COSTS.montageRender). Le
// montage étant facturé PLAN + RENDER, la somme doit donc faire 8.
const MONTAGE_PLAN_COST   = 4  // part « chef d'orchestre » (transcription Scribe + plan Claude)
const MONTAGE_RENDER_COST = 4  // = montageRender (MP4 monté par le moteur de rendu)
const MONTAGE_STYLES      = ['auto', 'apple', 'glass', 'dynamic', 'word']
const MONTAGE_MAX_BYTES   = 20_000_000 // limite du chef d'orchestre
// OmniHuman 1.5 (ByteDance via fal) — le moteur lipsync le plus réaliste (#107/#121)
const OMNI_COST_SEC = 5
const FAL_OMNI_PATH = 'fal-ai/bytedance/omnihuman/v1.5'
// ID d'APPLICATION fal (2 premiers segments) : c'est LUI qui sert au polling
// de la file d'attente, pas le chemin complet du modèle.
const FAL_OMNI_APP  = FAL_OMNI_PATH.split('/').slice(0, 2).join('/')
const FAL_QUEUE     = 'https://queue.fal.run'
const FAL_KEY = ['FALAI_API_KEY', 'FAL_KEY', 'FAL_API_KEY', 'FAL_AI_KEY', 'FALAI_KEY', 'FAL_SECRET']
  .map((n) => Deno.env.get(n)).find(Boolean) ?? ''
const falFetch = (path: string, init?: RequestInit) =>
  fetch(`${FAL_QUEUE}/${path}`, { ...init, headers: { Authorization: `Key ${FAL_KEY}`, ...(init?.headers || {}) } })
const GPT_IMG_MODELS  = ['gpt-image-2.5-flare', 'gpt-image-2']   // Axel 18/09 : MCP aligné sur l'app (gpt-image-2.5-flare, drop de gpt-image-1)
// Veo via kie.ai (Axel 25/09) : op_name « v1:<taskId> » = tâche kie (suivi veo/record-info), sinon opération Google.
// Préfixe NEUTRE (relecture 26/09) : le client lit ses lignes mcp_jobs (SELECT RLS) → jamais le nom du sous-traitant.
// « v1r:<taskId> » = tâche kie ÉCHOUÉE dont le repli Google est en cours (réservé par un seul suivi, voir replierSurGoogle).
const KIE_OP_PREFIX   = 'v1:'
const KIE_REPLI_PREFIX = 'v1r:'
// Durées acceptées par Veo 3.1 (Google comme kie) : 4 / 6 / 8 s. La durée demandée est ARRONDIE au cran supérieur
// (plafonnée à 8) AVANT le calcul du prix → le client paie exactement la durée générée (un « 5 s » part en 6 s, payé 6 s).
const veoCran = (s: number): number => (s <= 4 ? 4 : s <= 6 ? 6 : 8)
// Réalisme « UGC / makeugc » — MÊME bloc que le module Images IA de l'app
// (_IMG_REALISM_SUFFIX). Ajouté AUTOMATIQUEMENT à toute image de PERSONNE générée via
// le MCP → rendu photo Instagram réelle, plus de « random IA ». Leçon clé : le bloc
// porte le détail ET les INTERDITS (jamais lisser/plastifier/filtre beauté) — c'est
// l'interdit qui tue l'effet « peau de cire ». JAMAIS sur un produit (packshot).
// → désormais IMG_REALISM_SUFFIX de ../_shared/express-prompts.ts, recopié de l'app (01/10 : il manquait la clause tenue correcte / SFW).
const RE_PERSONNE = /\b(femmes?|filles?|hommes?|gar[çc]ons?|meufs?|nanas?|influenceu\w*|mannequins?|mod[eè]les?|models?|selfies?|portraits?|personnes?|gens|visages?|humains?|humans?|women|woman|man|men|girls?|boys?|guys?|ladies|lady|people|persons?|faces?|influencers?|creators?|avatars?|ugc)\b/i
// Genre (Axel 11/09) : influenceur = HOMME, influenceuse = FEMME. gpt-image ignore parfois le genre
// (biais « influenceuse » par défaut) → on l'ANCRE explicitement quand le prompt le désigne. Le féminin
// est testé À PART du masculin (influenceuSE ≠ influenceuR) ; prompt MIXTE (les deux) → on ne force rien.
// ── LOOK PRODUCTION (Axel 09/10) ─────────────────────────────────────────────
// Mêmes tirages que l'app (_mtLookProduction) : un style de sous-titres et un style
// de texte choc de Production, et une musique énergique au moins aussi longue que la
// vidéo. Listes = render-worker/production-look.mjs. Pas de musique si l'audio en a déjà une.
const PROD_SKINS = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S15', 'S16', 'S17', 'S18', 'S19', 'S21']
const PROD_CHOC = ['CS01', 'CS02', 'CS03', 'CS05', 'CS07', 'CS08', 'CS11', 'CS17']
const PROD_MUSIC: Record<string, number> = { M08: 186.2, M09: 14.9, M10: 26.4, M11: 17.9, M12: 21.8, M13: 30.9, M14: 60.0, M17: 14.2, M20: 40.5 }
function lookProduction(plan: Record<string, unknown>, dur: number) {
  plan.capSkin = pickRnd(PROD_SKINS)
  const hook = plan.hook as { text?: string } | null | undefined
  if (hook && hook.text) plan.chocStyle = pickRnd(PROD_CHOC)
  const det = plan.detected as { music?: boolean } | undefined
  if (det && det.music) return
  const ok = Object.keys(PROD_MUSIC).filter((id) => PROD_MUSIC[id] >= (Number(dur) || 0) + 0.5)
  const mood = ((plan.music as { mood?: string } | null) || {}).mood || 'dynamique'
  plan.music = ok.length ? { mood, track: pickRnd(ok) } : { mood }
}

function genreIndice(p: string): 'homme' | 'femme' | null {
  const fem = /\b(influenceuses?|femmes?|filles?|meufs?|nanas?|cr[ée]atrices?|actrices?|mannequines?|dames?|madames?|women|woman|female|girls?|ladies|lady)\b/i.test(p)
  const masc = /\b(influenceurs?|hommes?|gar[çc]ons?|mecs?|cr[ée]ateurs?|acteurs?|messieurs?|monsieur|men|man|male|boys?|guys?|dudes?|gentlem[ae]n)\b/i.test(p)
  if (fem && masc) return null   // couple / scène mixte → ne pas imposer un genre
  if (fem) return 'femme'
  if (masc) return 'homme'
  return null
}
// #aleatoire (Axel 18/09) : comme _imgVariationHint côté app — CHAQUE génération d'une PERSONNE
// reçoit un casting DIFFÉRENT (âge/cheveux/morpho/angle/bouche) → fini « toujours le même visage,
// toujours la bouche ouverte » ; chaque STATIC AD hors banque reçoit un angle marketing différent.
function pickRnd<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)] }
function castingAleatoire(): string {
  const age   = pickRnd(['in their early 20s', 'in their mid 20s', 'in their late 20s', 'around 30', 'in their early 30s', 'in their mid 30s'])
  const hair  = pickRnd(['dark brown', 'brown', 'light brown', 'black', 'dark blond', 'chestnut', 'ash brown', 'auburn'])
  const cut   = pickRnd(['short', 'medium-length', 'short and tousled', 'slightly wavy', 'straight', 'with loose curls', 'neatly styled'])
  const build = pickRnd(['slim', 'athletic', 'average', 'broad-shouldered'])
  const ang   = pickRnd(['looking straight into the camera', 'at a slight three-quarter angle', 'with a subtle head tilt', 'slightly turned toward the camera'])
  const mouth = pickRnd(['a calm expression with the mouth closed, lips gently together', 'a natural closed-mouth smile (mouth not open)', 'a relaxed neutral face, mouth closed', 'a soft closed-lipped confident look', 'lips only slightly parted in a subtle expression', 'mid-sentence with the mouth open while talking'])
  return ` Casting direction for THIS image (unless the description already specifies these): a distinct, unique individual ${age}, ${build} build, ${hair} ${cut} hair, ${ang}, ${mouth}. VARY the mouth and expression — do NOT always show an open, talking mouth. Make this person clearly DIFFERENT in face, hair and features from other generations.`
}
// (angle marketing inventé RETIRÉ le 18/09 — la variété des static ads vient des 59 formats VALIDÉS
//  de la banque, désormais ouverte à tous ; on n'invente pas d'angle.)
// N'augmente QUE si le prompt parle d'une personne (sinon on casserait un packshot produit).
// (02/10) appliqué AUSSI à la photo de départ des vidéos Express : sans ce bloc, la personne sortait « mannequin de pub »
// (Axel : « hyper IA, beaucoup trop artificiel, pas le même rendu que l'app »).
function augmenterPortrait(prompt: string): string {
  if (!RE_PERSONNE.test(prompt)) return prompt
  const g = genreIndice(prompt)
  const genreTxt = g === 'femme'
    ? ' The person is a WOMAN (female) — respect this gender exactly, never render a man.'
    : g === 'homme'
      ? ' The person is a MAN (male) — respect this gender exactly, never render a woman.'
      : ''
  const suffix = genreTxt + castingAleatoire() + IMG_REALISM_SUFFIX
  return prompt.slice(0, 3990 - suffix.length) + suffix
}
// Accès Starter/Pro/Élite (+ developer/owner) ; plafond de crédits dépensés via MCP par 24 h.
// Axel 19/09 : le connecteur Claude n'est plus un premium Pro/Élite — le Starter y a droit aussi.
const ALLOWED_PLANS   = ['starter', 'pro', 'elite']
const DAILY_CAPS: Record<string, number> = { starter: 50, pro: 100, elite: 200 }
// Axel 02/10 : « supprime les limites pour Starter, Pro et Élite, c'est inutile » → plus AUCUN plafond 24 h via le MCP
// (la seule limite = le solde de crédits). Remettre true réactive tout le mécanisme (réservation atomique mcp_cap_reserve).
const MCP_CAP_ON = false
// Axel 02/10 : plus de connexion par clé dans l'URL (aa_…) — uniquement OAuth (jetons aat_…)
const KEY_MODE_OFF = true

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  // WWW-Authenticate n'est PAS un header « safelisted » : sans Expose-Headers un
  // client MCP dans un NAVIGATEUR (vérification du nouvel écran claude.ai,
  // inspector) reçoit le 401 mais ne peut pas LIRE resource_metadata → la
  // découverte OAuth est « Ignorée ». Ajout 29/08, purement additif.
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function hashKey(key: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(key)))
  return Array.from(mac).map(b => b.toString(16).padStart(2, '0')).join('')
}
// Audit 04/10 (relecture, esprit de CC-4) : clé de plafond par IP sans l'IP en clair dans rate_events — empreinte HMAC
// (clé service, préfixe propre aux plafonds), tronquée à 32 caractères hexa (128 bits : aucune collision utile).
const cleIp = async (req: Request): Promise<string> => (await hashKey('rate-ip:' + realIp(req))).slice(0, 32)

// ── Capacité SIGNÉE d'un job (audit 05/09, H4/M5) ──────────────────────────────────────────────
// /regenerate et /start sont tapés par le widget (iframe claude.ai, AUCUN identifiant) avec le seul
// job_id — or ce job_id est publié en clair dans les liens de marque mcp.avatarads.fr/i/<job_id>.
// Un lien fuité permettait de DÉPENSER les crédits du propriétaire (3 cr par regénération, jusqu'au
// plafond 24 h) et d'imposer une image dans sa bibliothèque. Désormais chaque job reçoit une capacité
// `cap` = HMAC(clé service, 'cap:'+job_id), renvoyée UNIQUEMENT dans le structuredContent de l'outil
// (visible du seul propriétaire dans son chat) et exigée par /regenerate et /start. Le lien /i/ ne la
// porte pas → un job_id seul ne vaut plus rien.
async function jobCap(jobId: string): Promise<string> {
  return (await hashKey('cap:' + String(jobId))).slice(0, 32)
}
function timingSafeEqual(a: string, b: string): boolean {
  const x = String(a ?? ''), y = String(b ?? '')
  if (x.length !== y.length) return false
  let r = 0
  for (let i = 0; i < x.length; i++) r |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return r === 0
}
async function capOk(jobId: string, given: unknown): Promise<boolean> {
  return timingSafeEqual(await jobCap(jobId), String(given ?? ''))
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Tâche de fond garantie jusqu'au flush : sans ça, l'isolate edge peut être tué
// avant qu'une écriture « fire-and-forget » (ex. last_used_at, rattrapage) ne parte.
function bg(task: Promise<unknown>) {
  const ru = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (ru?.waitUntil) ru.waitUntil(task.catch(() => {}))
  else task.catch(() => {})
}

// Anti-SSRF : refuse les hôtes internes / link-local / metadata pour une URL fournie par l'utilisateur.
function isBlockedHost(hostname: string): boolean { return guardBlockedHost(hostname) }   // audit #3 : source unique durcie (guard.ts)

async function uploadMedia(userId: string, bytes: Uint8Array, ext: string, contentType: string): Promise<string> {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await svc.storage.from('mcp-media').upload(path, bytes, { contentType })
  if (error) throw new Error('upload: ' + error.message)
  return `${SUPABASE_URL}/storage/v1/object/public/mcp-media/${path}`
}
// ── mcp-media est PRIVÉ (audit 28/09 #28/#36 : visages, voix et vidéos des clients) ─────────────────────────────────
// La base garde l'adresse CANONIQUE « …/object/public/mcp-media/<chemin> » (anciennes lignes comprises) : elle ne s'ouvre
// plus telle quelle. On SIGNE au moment de servir (/status, /i/, list_media, toolMedia, vignettes, fournisseurs).
const MEDIA_PUB = `${SUPABASE_URL}/storage/v1/object/public/mcp-media/`
const MEDIA_SIGN = `${SUPABASE_URL}/storage/v1/object/sign/mcp-media/`
function mediaPath(url: string): string | null {
  const u = String(url || '')
  const base = u.startsWith(MEDIA_PUB) ? MEDIA_PUB : u.startsWith(MEDIA_SIGN) ? MEDIA_SIGN : ''
  if (!base) return null
  try { const p = decodeURIComponent(u.slice(base.length).split('?')[0]); return /^[A-Za-z0-9._\/-]+$/.test(p) && !p.includes('..') ? p : null } catch { return null }
}
async function signPath(path: string, ttlS: number): Promise<string | null> {
  try { const { data, error } = await svc.storage.from('mcp-media').createSignedUrl(path, ttlS); return !error && data?.signedUrl ? data.signedUrl : null } catch { return null }
}
// URL mcp-media → lien signé (7 jours par défaut) ; toute autre URL est rendue telle quelle.
async function signMedia(url: string | null | undefined, ttlS = 7 * 86400): Promise<string> {
  const u = String(url || ''); const p = mediaPath(u)
  if (!p) return u
  return (await signPath(p, ttlS)) || u
}

// ── FILET : ranger la création dans la BIBLIOTHÈQUE du compte ────────────────
// Une génération MCP n'apparaît PAS dans l'app (elle vit dans mcp-media, privé, l'app lit
// render-media privé + library_items). Or quand le proxy claude.ai mange la réponse, la carte
// ne s'affiche jamais : le client croit avoir tout perdu. On dépose donc une COPIE dans sa
// Bibliothèque (bucket render-media/<uid>/lib + ligne library_items, EXACTEMENT le format de
// l'app) → il retrouve TOUJOURS sa vidéo/image dans son compte, indépendamment de claude.ai.
// Best-effort absolu : jamais un throw ici ne doit empêcher la livraison.
async function saveToLibrary(userId: string, bytes: Uint8Array, ext: string, mime: string, kind: string, name: string, thumb?: string, meta?: { tags?: string[]; style?: string; emo?: string }): Promise<void> {
  try {
    const path = `${userId}/lib/mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await svc.storage.from('render-media').upload(path, bytes, { contentType: mime, upsert: true })
    if (error) return
    // mcp-media est privé (audit 28/09) : une vignette mcp-media devient une image INTÉGRÉE (data URL), jamais un lien qui expire
    let th = thumb
    const tp = th ? mediaPath(th) : null
    if (tp) {
      th = undefined
      try { const d = await svc.storage.from('mcp-media').download(tp); if (!d.error && d.data && d.data.size <= 600_000) th = `data:${d.data.type || 'image/jpeg'};base64,` + b64DepuisOctets(new Uint8Array(await d.data.arrayBuffer())) } catch { /* sans vignette */ }
    }
    await svc.from('library_items').insert({ user_id: userId, kind, name, tags: meta?.tags || [], storage_path: path, ...(meta?.style ? { style: meta.style } : {}), ...(meta?.emo ? { emo: meta.emo } : {}), ...(th ? { thumb: th } : {}) })
  } catch (_) { /* la Bibliothèque est un filet, jamais un bloquant */ }
}

// ── L'IMAGE DOIT S'AFFICHER DANS CLAUDE, PAS ÊTRE UN LIEN ───────────────────
// Axel : « les vidéos et images ne s'affichent pas dans Claude ». Le protocole
// MCP sait renvoyer un bloc `image` en base64, que le client rend en vignette —
// mais l'originale pèse 3 Mo (≈ 4 Mo une fois en base64), impensable dans un
// résultat d'outil. On fabrique donc une vignette ~640 px à la génération, une
// seule fois, et c'est elle qu'on renvoie. Si la vignette échoue, on retombe
// simplement sur le lien : jamais de génération perdue pour une miniature.
// ── GARDE « BOMBE D'IMAGE » (relecture 26/09) ────────────────────────────────────────────────────────────────────
// ImageScript décode en SYNCHRONE (boucle d'événements bloquée) et en RGBA plein (4 o/pixel) : un PNG de 50 Ko annonçant
// 30 000 × 30 000 px réclame 3,6 Go → isolate tué (mémoire Edge 256 Mo). On lit donc les dimensions dans l'EN-TÊTE
// (PNG IHDR, JPEG SOFn, WebP VP8 / VP8L / VP8X) AVANT tout décodage, et on ne décode que ≤ 8000 px par côté ET ≤ 25 Mpx
// (≈ 100 Mo RGBA : couvre le 24 Mpx par défaut des iPhone 15/16 — 5712 × 4284 = 24,5 Mpx —, un reflex 24 Mpx, la 4K).
// En-tête illisible = on ne décode pas.
const IMG_MAX_COTE = 8000
const IMG_MAX_PIXELS = 25_000_000
function dimsImage(b: Uint8Array): { w: number; h: number } | null {
  try {
    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {   // PNG : IHDR en tête
      if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
      return { w: dv.getUint32(16), h: dv.getUint32(20) }
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {   // JPEG : premier segment SOFn
      let i = 2
      while (i + 3 < b.length) {
        if (b[i] !== 0xff) return null
        let m = b[i + 1]
        while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1] }   // octets de bourrage
        i += 2
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue   // marqueurs sans longueur
        if (m === 0xd9 || m === 0xda) return null                            // fin / données avant tout SOF
        if (i + 1 >= b.length) return null
        const len = (b[i] << 8) | b[i + 1]
        if (len < 2) return null
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          if (i + 6 >= b.length) return null
          return { h: (b[i + 3] << 8) | b[i + 4], w: (b[i + 5] << 8) | b[i + 6] }
        }
        i += len
      }
      return null
    }
    if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {   // WebP
      const tag = String.fromCharCode(b[12], b[13], b[14], b[15])
      if (tag === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
      if (tag === 'VP8L') { const x = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return { w: 1 + (x & 0x3fff), h: 1 + ((x >>> 14) & 0x3fff) } }
      if (tag === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff }
    }
  } catch { /* en-tête tronqué */ }
  return null
}
// 'ok' = décodable sans risque · 'trop_grande' = dimensions annoncées hors limites · 'inconnue' = en-tête illisible.
function tailleImage(b: Uint8Array): 'ok' | 'trop_grande' | 'inconnue' {
  const d = dimsImage(b)
  if (!d || !d.w || !d.h) return 'inconnue'
  return d.w > IMG_MAX_COTE || d.h > IMG_MAX_COTE || d.w * d.h > IMG_MAX_PIXELS ? 'trop_grande' : 'ok'
}
const MSG_IMG_TROP_GRANDE = `image trop grande (${IMG_MAX_COTE} px max par côté, ${IMG_MAX_PIXELS / 1_000_000} Mpx max) — réduis-la puis relance`

const APERCU_LARGEUR = 1080   // vignette rendue en grand dans le fil claude.ai → nette (Axel « non pixélisé »)
async function fabriquerApercu(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (tailleImage(bytes) !== 'ok') return null   // jamais de décodage d'une image hors limites (bombe d'image)
    // 1.3.0 : la 1.2.17 plantait une fois sur deux sur les PNG gpt-image
    // (profils couleur) — c'est pour ça qu'Axel ne voyait « que des liens »
    const Image = await loadImage()
    const img = await Image.decode(bytes)
    if (img.width > APERCU_LARGEUR) img.resize(APERCU_LARGEUR, Image.RESIZE_AUTO)
    return await img.encodeJPEG(82)
  } catch (e) {
    console.error('apercu:', (e as Error)?.message || e)
    return null
  }
}
// Recadre une image AU RATIO cible (9:16 ou 16:9) par recadrage CENTRÉ. ⚠ Veo IGNORE
// `aspectRatio` quand on lui fournit une image de départ : il garde le ratio de l'IMAGE.
// Une photo 2:3 (ex. 1024×1536) sort donc en 2:3 et pas en 9:16. On recadre l'image
// AVANT de l'envoyer → la vidéo sort au bon format. Tolérance ±3 % (on ne touche pas si
// c'est déjà bon). Ne jette jamais vers l'appelant (try/catch côté bg).
async function reframeToAspect(bytes: Uint8Array, aspect: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const target = aspect === '16:9' ? 16 / 9 : 9 / 16
  const t = tailleImage(bytes)
  if (t !== 'ok') throw new Error(t === 'trop_grande' ? MSG_IMG_TROP_GRANDE : 'dimensions illisibles : image non recadrée')
  const Image = await loadImage()
  const img = await Image.decode(bytes)
  const cur = img.width / img.height
  if (Math.abs(cur - target) / target <= 0.03) return { bytes, mimeType: 'image/png' }
  let cw = img.width, ch = img.height, cx = 0, cy = 0
  if (cur > target) { cw = Math.round(img.height * target); cx = Math.round((img.width - cw) / 2) }
  else { ch = Math.round(img.width / target); cy = Math.round((img.height - ch) / 2) }
  const cropped = img.crop(cx, cy, cw, ch)
  return { bytes: await cropped.encode(), mimeType: 'image/png' }
}
// Un résultat d'outil ne doit pas dépasser ~1,5 Mo : au-delà, les clients
// tronquent ou refusent. Mais « trop gros » ne doit plus JAMAIS vouloir dire
// « pas d'image » : on REDIMENSIONNE à la volée (768 px JPEG ≈ 100-250 Ko).
const APERCU_MAX_OCTETS = 1_500_000
const b64DepuisOctets = (buf: Uint8Array): string => {
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}
async function blocImage(url: string): Promise<Record<string, unknown> | null> {
  try {
    url = await signMedia(url, 600)   // mcp-media privé (audit 28/09)
    try { const _u = new URL(url); if (!/^https?:$/.test(_u.protocol) || isBlockedHost(_u.hostname) || await hostResolvesInternal(_u.hostname)) return null } catch { return null }   // SSRF défense en profondeur (06/09 + round3 DNS)
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    if (!buf.length) return null
    // au-delà de 400 Ko on tente la réduction (l'image s'affiche pareil dans la
    // carte, et la conversation reste légère) ; en dessous, le fichier tel quel
    if (buf.length > 400_000) {
      const petit = await fabriquerApercu(buf)
      if (petit && petit.length <= APERCU_MAX_OCTETS)
        return { type: 'image', data: b64DepuisOctets(petit), mimeType: 'image/jpeg' }
    }
    if (buf.length > APERCU_MAX_OCTETS) return null   // réduction impossible ET trop gros
    const mime = /\.png($|\?)/i.test(url) ? 'image/png' : 'image/jpeg'
    return { type: 'image', data: b64DepuisOctets(buf), mimeType: mime }
  } catch { return null }
}

const isUnlimited = (p: Record<string, unknown>) =>
  (String(p.plan || '').toLowerCase() === 'developer') || !!p.is_owner
// Audit 02/10 : OmniHuman (lipsync haute résolution) = Pro & Élite ou compte illimité — la règle de lipsync_video (Axel 26/09),
// appliquée aussi au Montage IA (montage_ia, render_montage_plan). 'mix' (Omni au hook) = propriétaire seul (Axel 23/08).
const droitOmniHuman = (p: Record<string, unknown>) => isUnlimited(p) || ['pro', 'elite'].includes(String(p.plan || '').toLowerCase())
const modeleLipsyncAutorise = (p: Record<string, unknown>, m: unknown): boolean => {
  const v = String(m ?? '').toLowerCase()
  if (v === 'hedra') return true
  if (v === 'omnihuman' || v === 'omni') return droitOmniHuman(p)   // 'omni' = alias lu par le moteur de rendu
  if (v === 'mix') return p.is_owner === true
  return false   // valeur inconnue : retirée (le moteur prend hedra, le défaut)
}

async function spendCredits(userId: string, n: number): Promise<number | null> {
  const { data, error } = await svc.rpc('mcp_spend_credits', { p_user: userId, p_secs: n })
  return error ? null : (data as number)
}
async function refundCredits(userId: string, n: number): Promise<void> {
  const { error } = await svc.rpc('mcp_refund_credits', { p_user: userId, p_secs: n })
  if (error) console.error('[mcp] remboursement NON passé', userId, n, error.message)   // audit 02/10 : plus jamais silencieux
}
// Débit LIÉ AU JOB (relecture 26/09, migration 20260926010000) : le job est créé avec credits_cost = 0, la RPC débite
// ET pose credits_cost dans la même transaction. Tant que credits_cost vaut 0, rien n'a été débité → aucun filet ne peut
// rembourser (fin des crédits « rendus » sans avoir été pris quand l'isolate meurt entre l'insert et le débit).
// Retour : solde (>= 0) · -1 crédits insuffisants · -2 job déjà clos / déjà débité · null erreur technique (issue
// inconnue : l'appelant passe par failAndRefund, qui ne rend QUE le credits_cost réellement posé).
async function spendForJob(userId: string, jobId: string, cost: number): Promise<number | null> {
  const { data, error } = await svc.rpc('mcp_spend_for_job', { p_user: userId, p_job: jobId, p_cost: cost })
  if (error) { console.warn('[mcp] mcp_spend_for_job', jobId, error.message); return null }
  return typeof data === 'number' ? data : null
}

// Crédits dépensés via MCP sur les dernières 24 h (jobs vidéo + images, hors remboursés)
async function mcpSpentToday(userId: string): Promise<number> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const { data } = await svc.from('mcp_jobs').select('credits_cost, refunded')
    .eq('user_id', userId).gte('created_at', dayAgo)
  return (data || []).filter((j) => !j.refunded).reduce((s, j) => s + (j.credits_cost || 0), 0)
}

// Contexte d'exécution des outils (clé + plan)
type ToolCtx = { requireConfirm: boolean; dailyCap: number | null }

// Devis / plafond communs aux deux générateurs. Retourne null si on peut débiter.
async function preSpendGate(
  profile: Record<string, unknown>, ctx: ToolCtx, args: Record<string, unknown>,
  cost: number, label: string, toolName: string,
): Promise<ToolContent | null> {
  // Certains clients MCP envoient le booléen en chaîne (« true ») : même accord explicite, on l'accepte (25/09).
  const confirmed = args.confirm === true || String(args.confirm).toLowerCase() === 'true'
  if (ctx.requireConfirm && !confirmed) {
    const bal = Number(profile.credits_remaining) || 0
    const balTxt = isUnlimited(profile) ? '∞' : `${bal} → ${bal - cost} après génération`
    return toolText(
      `🧾 Devis — ${label}
Coût : ${cost} crédits · solde : ${balTxt}
Montre ce devis à l'utilisateur et attends son accord explicite, puis rappelle ${toolName} avec les mêmes paramètres + confirm: true. Ne confirme JAMAIS à sa place.`)
  }
  if (ctx.dailyCap !== null && !isUnlimited(profile)) {
    // Audit MCP 14/09 (F1) : réservation ATOMIQUE du plafond (compteur mcp_day_spent sous le verrou de ligne du
    // profil) au lieu d'un SELECT non-atomique de mcp_jobs → fin du TOCTOU (un burst concurrent ne dépasse plus le plafond).
    const { data: r } = await svc.rpc('mcp_cap_reserve', { p_user: String(profile.id), p_cost: cost, p_cap: ctx.dailyCap })
    if (typeof r === 'number' && r < 0) {
      return toolErr(`Plafond quotidien via Claude atteint : ${ctx.dailyCap} crédits sur 24 h (cette génération en demande ${cost}). Réessaie plus tard ou génère directement sur ${APP_URL}`)
    }
  }
  return null
}

// Audit 28/09 #23 : part du plafond 24 h réservée par preSpendGate mais AUCUN débit (refus après la porte) → rendue.
async function capReleaseUser(userId: string, cost: number | undefined, at?: string): Promise<void> {
  if (!(cost && cost > 0)) return
  try { await svc.rpc('mcp_cap_release', { p_user: userId, p_cost: Math.ceil(cost), ...(at ? { p_at: at } : {}) }) } catch { /* best-effort */ }
}
const capHeldOf = (profile: Record<string, unknown>, ctx: ToolCtx, cost: number) => (ctx.dailyCap !== null && !isUnlimited(profile)) ? cost : 0
const capRelease = (profile: Record<string, unknown>, ctx: ToolCtx, cost: number) => capReleaseUser(String(profile.id), capHeldOf(profile, ctx, cost))

// ── Réponses JSON-RPC / contenus d'outils ──
const rpcResult = (id: unknown, result: unknown) => json(200, { jsonrpc: '2.0', id, result })
const rpcError = (id: unknown, code: number, message: string) =>
  json(200, { jsonrpc: '2.0', id, error: { code, message } })
type ToolContent = { content: Array<Record<string, unknown>>; isError?: boolean; structuredContent?: Record<string, unknown> }
const toolText = (t: string, sc?: Record<string, unknown>): ToolContent => ({ content: [{ type: 'text', text: t }], ...(sc ? { structuredContent: sc } : {}) })
const toolErr = (t: string): ToolContent => ({ content: [{ type: 'text', text: t }], isError: true })

// ── ANNONCER UN MÉDIA, PAS SEULEMENT SON URL ────────────────────────────────
// J'avais affirmé à Axel qu'aucun serveur MCP ne pouvait faire apparaître une
// vidéo dans la conversation. C'était faux, et son contre-exemple l'a montré :
// Higgsfield y arrive. Le protocole ne connaît pas de type « vidéo », mais il
// connaît le LIEN DE RESSOURCE, qui porte un mimeType arbitraire — et ce que le
// client en fait ensuite n'est pas dans la spec, c'est son affaire.
// On ne peut pas embarquer le fichier : un montage pèse 20 Mo, impensable en
// base64 dans un résultat d'outil. Le lien, lui, coûte trois lignes.
// ── MCP APPS · LE VIEWER MÉDIA (#79) ────────────────────────────────────────
// claude.ai pré-charge ce template via resources/read (l'URI déclarée dans
// _meta.ui.resourceUri) puis l'affiche en iframe et lui pousse le résultat de
// l'outil par postMessage. Le média vient de structuredContent { url, kind, name }.
//
// ⚠⚠ LEÇON PLETOR (16/08) — apprise en inspectant api.pletor.ai/mcp, un connecteur
// PUBLIC qui MARCHE dans claude.ai : le JS du widget NE PEUT PAS être inline. La
// sandbox du host applique un CSP strict (pas de 'unsafe-inline' sur script-src)
// → notre <script> inline n'a JAMAIS tourné, le handshake ne partait pas, la carte
// restait vide. Pletor sert son JS depuis un domaine autorisé (leur API) et
// déclare `domain` + `ui/resourceUri` à plat. On fait pareil : JS servi à
// WIDGET_ORIGIN/widget.js, chargé en <script type=module src>.
const WIDGET_ORIGIN = 'https://mcp.avatarads.fr'
// Le corps du widget, servi tel quel à GET /widget.js (hors sandbox → autorisé).
const UI_WIDGET_JS = `
var aaLong=false, aaStatusU='', aaOk=false, aaSeen=[], aaHugW=0, aaId=100, aaUrlNow='', aaKindNow='', aaNameNow='', aaPollT=null, aaPct=5, aaStart=0, aaPrompt='', aaJobId='', aaFormat='portrait', aaRef='', aaRaw=false, aaProductUrl='', aaCap='';
// Requête vers l'HÔTE (claude.ai) — protocole MCP Apps : télécharger un fichier
// (ui/download-file), ouvrir un lien (ui/open-link), ou envoyer un message au chat
// (ui/message = régénérer). Le sandbox bloque download+popups DIRECTS depuis l'iframe,
// mais l'HÔTE peut les faire → c'est le mécanisme des boutons d'Alexya.
function aaSend(method, params){ try{ window.parent.postMessage({ jsonrpc:'2.0', id:(++aaId), method:method, params:params }, '*'); }catch(e){} }
// Médias acceptés par la carte : NOS hôtes seulement, en https (audit 02/10 : jamais une URL arbitraire dans la page).
function aaSafeUrl(u){ try{ var x=new URL(String(u||'')); return (x.protocol==='https:'&&(x.hostname==='mcp.avatarads.fr'||x.hostname==='guvwgiejzkiodghywpwj.supabase.co'))?x.href:''; }catch(e){ return ''; } }
function aaUrlFrom(out){
  var sc=(out&&(out.structuredContent||out))||{};
  var url=aaSafeUrl(sc.url||'');
  // repli « lien dans le texte » : seulement si l'outil n'a renvoyé AUCUNE carte structurée et que ce n'est pas une erreur
  if(!url&&out&&out.content&&!out.isError&&!out.structuredContent){ for(var i=0;i<out.content.length;i++){ var t=(out.content[i]&&out.content[i].text)||''; var mm=/https:[^\\s)\\]"'<>]+/.exec(t); if(mm&&aaSafeUrl(mm[0])&&/\\/i\\/[0-9a-f-]{36}/.test(mm[0])){ url=aaSafeUrl(mm[0]); break; } } }
  return { waiting:!!sc.waiting, url:url, kind:sc.kind||'', name:sc.name||'', statusUrl:sc.statusUrl||sc.status_url||'', prompt:sc.prompt||'', job_id:sc.job_id||'', format:sc.format||'', ref:sc.ref||'', raw:!!sc.raw, pending:!!sc.pending, productUrl:sc.productUrl||'', cap:sc.cap||'', forVideo:!!sc.forVideo, forProduct:!!sc.forProduct, tool:sc.tool||'', rate:sc.rate||0, maxDur:sc.maxDur||0, charSrc:sc.charSrc||'', refSrc:sc.refSrc||'' };
}
function aaBtns(){
  var b=document.getElementById('b'); if(b) b.style.display='flex';
  var dl=document.getElementById('dl'), rg=document.getElementById('rg');
  var v=aaKindNow==='video';
  // Télécharger : claude.ai N'honore PAS ui/download-file, mais honore ui/open-link.
  // Lien de MARQUE mcp.avatarads.fr/i/<jobId>?download=<nom> (302 → média + Content-
  // Disposition:attachment) au lieu de l'URL Supabase brute dans la modale « Ouvrir le lien ».
  // Repli aaUrlNow (déjà en /i/ pour les vidéos) s'il n'y a pas de job_id.
  if(dl){ dl.disabled=false; dl.onclick=function(){ var fn=(aaNameNow||'avatarads')+(v?'.mp4':'.png'); var base=aaJobId?('https://mcp.avatarads.fr/i/'+aaJobId):aaUrlNow; var u=base+(base.indexOf('?')<0?'?':'&')+'download='+encodeURIComponent(fn); aaSend('ui/open-link', { url:u }); }; }
  // Regénérer EN UN CLIC : le widget tape /regenerate (job_id = capacité) → PAS de chat,
  // pas d'avertissement. La MÊME carte repart en mode progression → nouvelle image.
  // ⚠ /regenerate est IMAGE-ONLY → sur une VIDÉO on cache le bouton (pas de re-gen vidéo).
  if(rg){ if(v){ rg.style.display='none'; } else { rg.style.display=''; rg.disabled=false; rg.textContent='↻ Regénérer'; rg.onclick=function(){
    if(!aaJobId||!aaPrompt){ return; }
    var lbl='↻ Regénérer'; rg.disabled=true; rg.textContent='↻ …';
    fetch('https://mcp.avatarads.fr/regenerate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ job:aaJobId, prompt:aaPrompt, format:aaFormat||'portrait', ref:aaRef||'', raw:!!aaRaw, cap:aaCap }) })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
      .then(function(x){ if(x.ok&&x.j&&x.j.statusUrl){ aaJobId=x.j.job_id||aaJobId; if(x.j.cap) aaCap=x.j.cap; aaOk=false; aaPct=5; aaStartPoll(x.j.statusUrl); } else { var er=(x.j&&x.j.error)||''; rg.textContent=er==='busy'?'Limite horaire atteinte':er==='daily_cap'?'Plafond 24 h':(er==='no_credits'||er==='credits')?'Crédits épuisés':'Échec'; setTimeout(function(){ rg.textContent=lbl; rg.disabled=false; }, er==='busy'?60000:2400); } })
      .catch(function(){ rg.textContent='Réessaie'; setTimeout(function(){ rg.textContent=lbl; rg.disabled=false; }, 2200); });
  }; } }
}
function aaMedia(url, kind, name){
  aaOk=true; aaUrlNow=url; aaNameNow=(name||'').replace(/[^a-z0-9]+/gi,'-').toLowerCase();
  var v=kind==='video'||/\\.(mp4|mov|webm|m4v)(\\?|#|$)/i.test(url); aaKindNow=v?'video':'image';
  var m=document.getElementById('m');
  url=aaSafeUrl(url); if(!url){ m.textContent='Média indisponible.'; aaKick(); return; }
  m.innerHTML='';
  var el=document.createElement(v?'video':'img'); el.className='aa-m';
  if(v){ el.setAttribute('playsinline',''); el.preload='metadata'; el.src=url+'#t=0.1'; } else { el.alt=''; el.src=url; }
  m.appendChild(el);
  var prv=aaSafeUrl(aaPrev);
  if(v && prv){   // Axel 01/10 : la photo de départ (payée) reste livrée au-dessus de la vidéo
    m.insertAdjacentHTML('afterbegin', '<div style="text-align:center;margin:0 0 10px"><img id="pvi" alt="" class="aa-m" style="max-height:420px"><div style="margin-top:6px"><button class="aa-a aa-rg" id="dlp" type="button" style="border:none;cursor:pointer">Télécharger la photo</button></div></div>');
    var pvi=document.getElementById('pvi'); if(pvi){ pvi.src=prv; pvi.addEventListener('load', aaKick); }
    var dlp=document.getElementById('dlp'); if(dlp) dlp.onclick=function(){ aaSend('ui/open-link', { url: aaJobId ? ('https://mcp.avatarads.fr/i/'+aaJobId+'?photo=1&download=photo-depart.png') : prv }); };
  }
  // Axel 02/10 : vidéo PROPRE — aucune commande affichée tant que la souris n'est pas dessus (aussi à l'arrivée) ;
  // survol / toucher / clic → commandes visibles, sortie → masquées.
  var vd=m.querySelector('video');
  if(vd){ var _on=function(){ vd.controls=true; }, _off=function(){ vd.controls=false; };
    vd.controls=false; vd.addEventListener('mouseenter',_on); vd.addEventListener('mouseleave',_off);
    vd.addEventListener('touchstart',_on,{passive:true}); vd.addEventListener('click',function(){ if(!vd.controls){ vd.controls=true; vd.play().catch(function(){}); } }); }
  var media=vd;
  if(!media) media=m.querySelector('img');
  if(media){ media.addEventListener(v?'loadeddata':'load', aaKick); if(v) media.addEventListener('loadedmetadata', aaKick); }
  m.style.padding='0'; m.style.opacity=''; m.style.fontSize=''; aaBtns(); aaKick(); // 02/09 : plus AUCUN voile hérité de l'état « chargement » sur l'image finale
}
function aaSetPct(p){ if(p>aaPct) aaPct=p; var pb=document.getElementById('pb'); if(pb) pb.style.width=aaPct+'%'; }
function aaPollStatus(u){
  fetch(u, { cache:'no-store' }).then(function(r){ return r.json(); }).then(function(j){
    if(!j) return;
    if(typeof j.progress==='number') aaSetPct(j.progress);
    if(j.preview&&aaSafeUrl(j.preview)) aaPrev=aaSafeUrl(j.preview);
    if(j.preview&&aaSafeUrl(j.preview)){ var pv=document.getElementById('pv'); if(pv && !pv.firstChild){ var im=document.createElement('img'); im.alt=''; im.style.cssText='display:block;max-width:100%;max-height:420px;margin:12px auto 4px;border-radius:12px'; im.addEventListener('load', aaKick); im.src=aaSafeUrl(j.preview); pv.appendChild(im); var pt0=document.getElementById('pt'); if(pt0) pt0.textContent='Photo prête — vidéo en cours…'; aaKick(); } }
    if(j.status==='done' && j.url){ if(aaPollT){ clearInterval(aaPollT); aaPollT=null; } aaSetPct(100); setTimeout(function(){ aaMedia(j.url, j.kind||'image', ''); }, 350); return; }
    if(j.status==='failed'){ if(aaPollT){ clearInterval(aaPollT); aaPollT=null; } var pt=document.getElementById('pt'); if(pt) pt.textContent=j.msg||(aaPrev?'La vidéo a échoué (crédits de la vidéo rendus) — ta photo de départ est gardée, aussi dans ta Bibliothèque.':'Échec de la génération — réessaie.');
      var pw=document.querySelector('.aa-pw'); if(pw) pw.style.display='none';
      if(aaPrev&&!document.getElementById('dlp')){ var pv2=document.getElementById('pv'); if(pv2&&!pv2.firstChild){ var im2=document.createElement('img'); im2.alt=''; im2.style.cssText='display:block;max-width:100%;max-height:420px;margin:12px auto 4px;border-radius:12px'; im2.addEventListener('load', aaKick); im2.src=aaPrev; pv2.appendChild(im2); }
        if(pv2){ var bd=document.createElement('button'); bd.className='aa-a aa-rg'; bd.id='dlp'; bd.type='button'; bd.style.cssText='border:none;cursor:pointer;margin:6px auto 10px;display:block'; bd.textContent='Télécharger la photo'; bd.onclick=function(){ aaSend('ui/open-link', { url:'https://mcp.avatarads.fr/i/'+aaJobId+'?photo=1&download=photo-depart.png' }); }; pv2.appendChild(bd); } }
      aaKick(); }
    if(j.status==='pending' && j.link_failed){ aaProductUrl=''; aaAskPhoto(); var pe2=document.getElementById('pe'); if(pe2) pe2.textContent=j.link_failed==='no_image_in_link'?'Photo non récupérable depuis le lien (site protégé) — dépose-la ici.':j.link_failed==='daily_cap'?'Plafond 24 h atteint':(j.link_failed==='no_credits'||j.link_failed==='credits')?'Crédits épuisés — recharge sur avatarads.fr':'Lien illisible — dépose la photo ici.'; }
  }).catch(function(){});
}
var aaPollN=0;
function aaStartPoll(u){
  aaStart=Date.now();
  var b=document.getElementById('b'); if(b) b.style.display='none';
  var m=document.getElementById('m');
  m.style.opacity=''; m.innerHTML='<div id="pv"></div><div class="aa-pt" id="pt">Génération en cours…</div><div class="aa-pw"><div class="aa-pb" id="pb"></div></div>';
  aaSetPct(6); aaKick(); aaPollStatus(u);
  aaPollT=setInterval(function(){ var el=Date.now()-aaStart; if(el>(aaLong?1800000:900000)){ if(aaPollT){ clearInterval(aaPollT); aaPollT=null; } return; } if(el>240000 && (aaPollN=(aaPollN||0)+1)%4) return; aaPollStatus(u); }, 2500);   // 15 min ; au-delà de 4 min : une sonde toutes les 10 s
}
function aaShow(out){
  try{
    if(out&&out.isError){   // erreur d'outil : texte brut (jamais pris pour un média)
      var t0=''; try{ t0=(out.content&&out.content[0]&&out.content[0].text)||''; }catch(e){}
      aaOk=true; var me=document.getElementById('m'); if(me){ me.style.opacity='.85'; me.textContent=t0||'Échec — réessaie.'; } aaKick(); return;
    }
    var d=aaUrlFrom(out);
    if(d.statusUrl&&!(new RegExp('^https://mcp[.]avatarads[.]fr/status/[0-9a-f-]{36}$')).test(d.statusUrl)) d.statusUrl='';
    if(d.prompt) aaPrompt=d.prompt;
    if(d.job_id&&!aaJobId) aaJobId=d.job_id;
    if(d.format) aaFormat=d.format;
    if(d.ref) aaRef=d.ref; if(d.raw) aaRaw=true; if(d.productUrl) aaProductUrl=d.productUrl; if(d.cap&&!aaCap) aaCap=d.cap; if(d.forVideo) aaForVideo=true; if(d.forProduct) aaForProduct=true; if(d.tool){ aaTool=d.tool; aaRate=d.rate; aaMaxDur=d.maxDur||(d.tool==='edit'?10:30); aaCharSrc=aaSafeUrl(d.charSrc); aaRefSrc=aaSafeUrl(d.refSrc); aaLong=true; }
    if(d.url){ aaMedia(d.url, d.kind, d.name); return; }
    if(d.waiting){ aaOk=true; var mw=document.getElementById('m'); if(mw){ mw.style.opacity='.75'; mw.textContent='En attente de la photo dans la carte au-dessus \u2014 rien n\u2019est en cours.'; } aaKick(); return; }   // Axel 01/10 : jamais de fausse barre
    if(d.pending){
      if(!aaTool){ aaAskPhoto(); return; }
      // carte réaffichée (reconnexion) : si la génération est déjà partie, on suit sa progression au lieu de redemander le fichier
      var su=d.statusUrl||('https://mcp.avatarads.fr/status/'+aaJobId); aaStatusU=su;
      fetch(su,{ cache:'no-store' }).then(function(r){ return r.json(); }).then(function(j){ if(j&&(j.status==='running'||j.status==='done'||j.status==='failed')){ aaOk=false; aaPct=5; aaStartPoll(su); } else aaAskMedia(); }).catch(function(){ aaAskMedia(); });
      return;
    }
    if(d.statusUrl){ aaStatusU=d.statusUrl; aaStartPoll(d.statusUrl); return; }
  }catch(e){}
}
// ── PHOTO DU PRODUIT DANS LA CARTE (21/08) : claude.ai ne transmet pas les images jointes aux outils →
//    l'utilisateur la dépose ICI (glisser / choisir / coller), le widget l'envoie à /start qui lance la
//    génération avec le produit à l'identique, dans la MÊME carte. « Sans photo » = génération libre. ──
var aaForVideo=false, aaForProduct=false, aaPrev='';
function aaAskPhoto(){
  aaOk=true; if(aaPollT){ clearInterval(aaPollT); aaPollT=null; }
  var b=document.getElementById('b'); if(b) b.style.display='none';
  var m=document.getElementById('m'); m.style.padding='0';
  m.innerHTML='<div id="dz" style="margin:12px;padding:20px 16px;text-align:center;border:1.5px dashed var(--aa-line);border-radius:12px;transition:border-color .15s">'
    +'<div style="font-size:14.5px;font-weight:700;margin-bottom:4px">Dépose la photo de ton produit</div>'
    +'<div style="font-size:12px;opacity:.72;margin-bottom:14px">Glisse-la ici, choisis-la ou colle-la (⌘V) · PNG, JPG, WebP — elle sera reproduite à l\\'identique</div>'
    +'<input type="file" id="fi" accept="image/png,image/jpeg,image/webp" style="display:none">'
    +'<button class="aa-a aa-dl" id="pick" type="button" style="border:none;cursor:pointer">Choisir une photo</button>'
    +'<button class="aa-a aa-rg" id="skip" type="button" style="border:none;cursor:pointer;margin-left:8px">Sans photo</button>'
    +'<div style="display:flex;gap:6px;margin-top:12px;align-items:center"><input id="pl" type="url" placeholder="ou colle le lien de la page produit…" style="flex:1;min-width:0;font-size:12px;padding:8px 10px;border-radius:9px;border:1px solid var(--aa-line);background:transparent;color:inherit;outline:none"><button class="aa-a aa-rg" id="go" type="button" style="border:none;cursor:pointer;padding:8px 12px">OK</button></div>'
    +'<div id="pe" style="font-size:12px;margin-top:10px;min-height:16px;opacity:.85"></div></div>';
  var dz=document.getElementById('dz'), fi=document.getElementById('fi');
  document.getElementById('pick').onclick=function(){ try{ fi.click(); }catch(e){ var pe=document.getElementById('pe'); if(pe) pe.textContent='Glisse la photo directement dans la carte.'; } };
  fi.onchange=function(){ if(fi.files&&fi.files[0]) aaSendPhoto(fi.files[0]); };
  dz.addEventListener('dragover',function(e){ e.preventDefault(); dz.style.borderColor='#FF5A1F'; });
  dz.addEventListener('dragleave',function(){ dz.style.borderColor=''; });
  dz.addEventListener('drop',function(e){ e.preventDefault(); dz.style.borderColor=''; var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(f) aaSendPhoto(f); });
  document.addEventListener('paste',function(e){ var it=e.clipboardData&&e.clipboardData.items; if(!it) return; for(var i=0;i<it.length;i++){ if(it[i].type&&it[i].type.indexOf('image/')===0){ var f=it[i].getAsFile(); if(f){ aaSendPhoto(f); break; } } } });
  document.getElementById('skip').onclick=function(){ aaStartJob(''); };
  var pl=document.getElementById('pl'), go=document.getElementById('go');
  if(aaForVideo){   // vidéo : la photo de départ seulement (pas de « Sans photo », pas de lien produit)
    var _t=dz.querySelector('div'); if(_t) _t.textContent=aaForProduct?'Dépose la photo de ton produit':'Dépose ta photo de départ';
    var _s=dz.querySelectorAll('div')[1]; if(_s) _s.textContent=aaForProduct?'Glisse la photo officielle du produit ici, choisis-la ou colle-la (⌘V) — la photo puis la vidéo se lancent ensuite':'Glisse-la ici, choisis-la ou colle-la (⌘V) · PNG, JPG, WebP — la vidéo se lance dès que tu la déposes';
    var _sk=document.getElementById('skip'); if(_sk) _sk.style.display='none';
    if(pl&&pl.parentNode) pl.parentNode.style.display='none';
  }
  // lien produit : le serveur lance déjà la lecture du lien (audit 02/10 : la carte ne relance plus /start d'elle-même)
  var _go2=null;
  var sendLink=function(){ var v=(pl.value||'').trim(); if(!(new RegExp('^https?://','i')).test(v)){ var pe=document.getElementById('pe'); if(pe) pe.textContent='Colle un lien complet (https://…)'; return; } aaStartJob('', v); };
  go.onclick=sendLink; pl.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); sendLink(); } });
  pl.addEventListener('paste',function(e){ e.stopPropagation(); });   // coller un lien ≠ coller une image
  aaHugW=Math.max(320, Math.min(560, Math.ceil(window.innerWidth||420))); aaMeasure();
}
function aaSendPhoto(file){
  var pe=document.getElementById('pe'); if(pe) pe.textContent='Préparation de la photo…';
  if(!file||!(new RegExp('^image/(png|jpe?g|webp)$')).test(file.type||'')){ if(pe) pe.textContent='PNG, JPG ou WebP uniquement.'; return; }
  var fr=new FileReader();
  fr.onload=function(){
    var img=new Image();
    img.onload=function(){
      var k=Math.min(1, 2048/Math.max(img.naturalWidth||1, img.naturalHeight||1));
      var cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round((img.naturalWidth||1)*k)); cv.height=Math.max(1,Math.round((img.naturalHeight||1)*k));
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      var out=cv.toDataURL(file.type==='image/png'?'image/png':'image/jpeg', 0.92);
      aaStartJob(out);
    };
    img.onerror=function(){ if(pe) pe.textContent='Image illisible — essaie un PNG ou un JPG.'; };
    img.src=fr.result;
  };
  fr.readAsDataURL(file);
}
function aaStartJob(dataUrl, link){
  var pe=document.getElementById('pe'); if(pe) pe.textContent=link?'Lecture de la page produit…':(dataUrl?'Envoi de la photo…':'Lancement…');
  var pk=document.getElementById('pick'), sk=document.getElementById('skip'); if(pk) pk.disabled=true; if(sk) sk.disabled=true;
  fetch('https://mcp.avatarads.fr/start', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ job:aaJobId, data_url:dataUrl||'', product_url:link||'', skip:!dataUrl&&!link, cap:aaCap }) })
    .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(x){
      if(x.ok&&x.j&&x.j.statusUrl){ if(x.j.ref) aaRef=x.j.ref; if(x.j.prompt) aaPrompt=x.j.prompt; aaRaw=true; aaOk=false; aaPct=5; aaStartPoll(x.j.statusUrl); return; }
      var er=(x.j&&x.j.error)||'';
      if(er==='not_pending'&&aaJobId){ aaOk=false; aaPct=5; aaStartPoll('https://mcp.avatarads.fr/status/'+aaJobId); return; }   // déjà lancé (carte rechargée) : on suit la génération
      if(pe) pe.textContent = er==='daily_cap'?'Plafond 24 h atteint':(er==='no_credits'||er==='credits')?'Crédits épuisés — recharge sur avatarads.fr':er==='expired'?'Carte expirée — redemande à Claude':er==='not_pending'?'':er==='plan'?'Réservé aux plans Starter, Pro et Élite':er==='no_image_in_link'?'Photo non récupérable depuis ce lien (site protégé) — dépose-la ci-dessus, ou colle le lien DIRECT de l\\'image':'Échec ('+(er||'réseau')+') — réessaie';
      if(pk) pk.disabled=false; if(sk) sk.disabled=false;
    })
    .catch(function(){ if(pe) pe.textContent='Réseau indisponible — réessaie.'; if(pk) pk.disabled=false; if(sk) sk.disabled=false; });
}
// ── OUTILS VIDÉO (Omni « edit » / Motion Control « motion », Axel 02/10) : dépôt DANS la carte → envoi direct au stockage
//    (lien signé, progression), cadrage du personnage comme l’app (_mcPrepChar : ratio de la vidéo de réf + visage), lancement.
var aaSent=false, aaRetryN=0, aaTool='', aaRate=0, aaMaxDur=0, aaCharSrc='', aaRefSrc='', aaVid=null, aaVidDur=0, aaVidW=0, aaVidH=0, aaChar=null, aaBusy=false;
function aaEl(id){ return document.getElementById(id); }
function aaMsg(t){ var pe=aaEl('pe'); if(pe) pe.textContent=t||''; aaKick(); }
function aaZone(id, titre, sous, accept){
  return '<div id="'+id+'" style="margin:12px;padding:16px;text-align:center;border:1.5px dashed var(--aa-line);border-radius:12px;transition:border-color .15s">'
    +'<div style="font-size:14.5px;font-weight:700;margin-bottom:4px">'+titre+'</div>'
    +'<div id="'+id+'s" style="font-size:12px;opacity:.72;margin-bottom:12px">'+sous+'</div>'
    +'<input type="file" id="'+id+'f" accept="'+accept+'" style="display:none">'
    +'<button class="aa-a aa-dl" id="'+id+'b" type="button" style="border:none;cursor:pointer">Choisir</button></div>';
}
function aaWire(id, onFile){
  var z=aaEl(id), f=aaEl(id+'f'), b=aaEl(id+'b'); if(!z) return;
  b.onclick=function(){ try{ f.click(); }catch(e){ aaMsg('Glisse le fichier directement dans la carte.'); } };
  f.onchange=function(){ if(f.files&&f.files[0]) onFile(f.files[0]); };
  z.addEventListener('dragover',function(e){ e.preventDefault(); z.style.borderColor='#FF5A1F'; });
  z.addEventListener('dragleave',function(){ z.style.borderColor=''; });
  z.addEventListener('drop',function(e){ e.preventDefault(); z.style.borderColor=''; var x=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(x) onFile(x); });
}
function aaDone(id, txt){ var s=aaEl(id+'s'), b=aaEl(id+'b'), z=aaEl(id); if(s) s.textContent=txt; if(b) b.textContent='Changer'; if(z) z.style.borderStyle='solid'; aaKick(); }
function aaAskMedia(){
  aaOk=true; if(aaPollT){ clearInterval(aaPollT); aaPollT=null; }
  var b=aaEl('b'); if(b) b.style.display='none';
  var m=aaEl('m'); m.style.padding='0';
  var h='';
  if(aaTool==='motion'){
    h+= aaCharSrc ? '' : aaZone('zc','1. Photo du personnage','La personne qui va bouger · PNG, JPG, WebP','image/png,image/jpeg,image/webp');
    h+= aaRefSrc ? '' : aaZone('zv',(aaCharSrc?'':'2. ')+'Vidéo de référence','Le mouvement à copier · MP4 ou MOV · '+(aaMaxDur<30?'les '+aaMaxDur+' premières secondes':'3 à 30 s'),'video/mp4,video/quicktime,video/webm');
  } else h+= aaRefSrc ? '' : aaZone('zv','Dépose ta vidéo','MP4 ou MOV · '+(aaMaxDur<10?'les '+aaMaxDur+' premières secondes':'10 s max (au-delà, les 10 premières secondes)')+' — la transformation se lance dès qu’elle est déposée','video/mp4,video/quicktime,video/webm');
  h+='<div id="pe" style="font-size:12px;margin:0 14px 14px;min-height:16px;opacity:.85"></div>';
  m.innerHTML=h;
  aaWire('zc', aaPickChar); aaWire('zv', aaPickVid);
  aaHugW=Math.max(320, Math.min(560, Math.ceil(window.innerWidth||420))); aaMeasure();
  if(aaCharSrc){ var ic=new Image(); ic.crossOrigin='anonymous'; ic.onload=function(){ aaChar=ic; aaMaybeGo(); }; ic.onerror=function(){ aaMsg('Photo du personnage illisible — redemande à Claude.'); }; ic.src=aaCharSrc; }
  if(aaRefSrc){ aaLoadVid(aaRefSrc, null); }
}
function aaPickChar(file){
  if(aaBusy) return;
  if(!file||!(new RegExp('^image/(png|jpe?g|webp)$')).test(file.type||'')){ aaMsg('Photo : PNG, JPG ou WebP uniquement.'); return; }
  var u=URL.createObjectURL(file), im=new Image();
  im.onload=function(){ aaChar=im; aaDone('zc', (file.name||'photo')+' · '+im.naturalWidth+'×'+im.naturalHeight); aaMaybeGo(); };
  im.onerror=function(){ aaMsg('Image illisible — essaie un JPG ou un PNG.'); };
  im.src=u;
}
function aaPickVid(file){
  if(aaBusy) return;
  if(!file||!(new RegExp('^video/(mp4|quicktime|webm|x-m4v)$')).test(file.type||'')){ aaMsg('Vidéo : MP4, MOV ou WebM uniquement.'); return; }
  if(file.size>200000000){ aaMsg('Vidéo trop lourde (200 Mo maximum).'); return; }
  aaLoadVid(URL.createObjectURL(file), file);
}
function aaLoadVid(src, file){
  var v=document.createElement('video'); v.muted=true; v.playsInline=true; v.preload='auto'; if(!file) v.crossOrigin='anonymous';
  var fini=false, ok=function(){
    if(fini) return; fini=true;
    var d=v.duration||0;
    var mx=aaMaxDur||(aaTool==='edit'?10:30);
    if(d && d<(aaTool==='edit'?0.8:1)){ aaMsg('Vidéo trop courte (1 s minimum).'); return; }
    aaVid={ el:v, file:file, src:src }; aaVidDur=d; aaVidW=v.videoWidth||0; aaVidH=v.videoHeight||0;
    var dk=Math.min(d, mx);   // durée GARDÉE (la préparation coupe au-delà ; la facture suit la vidéo préparée)
    var bill=aaTool==='edit'?Math.max(1,Math.ceil(dk)):Math.min(30,Math.ceil(dk<3.3?3.6:dk));
    var txt=(file?(file.name||'vidéo'):'vidéo fournie')+(d?' · '+d.toFixed(1)+' s · ≈ '+(bill*aaRate)+' crédits':'')+(d>mx+0.5?' (les '+mx+' premières secondes)':'');
    if(aaEl('zv')) aaDone('zv', txt); else aaMsg(txt);
    if(d>mx+0.5 && mx>=(aaTool==='edit'?10:30)){ aaTrimAsk(d, mx, bill); return; }   // trop longue : l'utilisateur confirme la coupe
    aaMaybeGo();
  };
  v.onloadedmetadata=ok; v.onerror=function(){ if(fini) return; fini=true; aaVid={ el:null, file:file, src:src }; aaVidDur=0; if(aaEl('zv')) aaDone('zv',(file?(file.name||'vidéo'):'vidéo')+' · format lu par le serveur'); aaMaybeGo(); };
  setTimeout(function(){ if(!fini){ v.onerror(); } }, 8000);
  v.src=src;
}
// Vidéo plus longue que la limite du module (10 s Omni, 30 s Motion Control) : la carte le DIT et attend un clic au lieu de
// lancer seule (Axel 04/10 : la question de durée ne se pose que dans ce cas — Claude ne voit pas la vidéo).
function aaTrimAsk(d, mx, bill){
  var pe=aaEl('pe'); if(!pe){ aaMaybeGo(); return; }
  pe.textContent='Ta vidéo fait '+d.toFixed(1).replace('.',',')+' s : seules les '+mx+' premières secondes seront utilisées. ';
  var b=document.createElement('button'); b.className='aa-a aa-dl'; b.type='button'; b.style.cssText='border:none;cursor:pointer;margin-left:6px';
  b.textContent='Lancer · '+(bill*aaRate)+' crédits';
  b.onclick=function(){ b.disabled=true; pe.textContent=''; aaMaybeGo(); };
  pe.appendChild(b); aaKick();
}
function aaMaybeGo(){
  if(aaBusy||!aaVid) return;
  if(aaTool==='motion'&&!aaChar){ aaMsg('Il manque la photo du personnage.'); return; }
  aaBusy=true; aaGo().catch(function(e){ aaBusy=false; aaMsg(String(e&&e.message||e)); });
}
function aaRelancer(t){
  var pe=aaEl('pe'); if(!pe) return; pe.textContent=t+' ';
  var b=document.createElement('button'); b.className='aa-a aa-dl'; b.type='button'; b.style.cssText='border:none;cursor:pointer;margin-left:6px'; b.textContent='Relancer';
  b.onclick=function(){ b.disabled=true; aaRetryN=0; aaLance().catch(function(e){ aaMsg(String(e&&e.message||e)); }); };
  pe.appendChild(b); aaKick();
}
function aaPost(path, body){ return fetch('https://mcp.avatarads.fr/'+path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j||{} }; }); }); }
function aaPut(url, blob, type, label){
  return new Promise(function(res, rej){
    var x=new XMLHttpRequest(); x.open('PUT', url); x.setRequestHeader('Content-Type', type); x.setRequestHeader('x-upsert','true');
    x.upload.onprogress=function(e){ if(e.lengthComputable) aaMsg(label+' '+Math.round(e.loaded/e.total*100)+' %'); };
    x.onload=function(){ if(x.status>=200&&x.status<300) res(); else rej(new Error('Envoi refusé ('+x.status+') — réessaie.')); };
    x.onerror=function(){ rej(new Error('Réseau coupé pendant l’envoi — réessaie.')); };
    x.send(blob);
  });
}
function aaUrl(slot, type, size){ return aaPost('upload-url', { job:aaJobId, cap:aaCap, slot:slot, type:type, size:size }).then(function(x){ if(!x.ok||!x.j.url){ var er=x.j.error||''; throw new Error(er==='expired'?'Carte expirée — redemande à Claude.':er==='too_large'?'Fichier trop lourd.':er==='bad_type'?'Format non accepté.':er==='not_pending'?'Déjà lancé.':'Envoi impossible ('+(er||'réseau')+').'); } return x.j.url; }); }
function aaJpeg(cv, q){ return new Promise(function(r){ cv.toBlob(function(b){ r(b); }, 'image/jpeg', q||0.9); }); }
function aaSmall(src, w, h){ var k=Math.min(1, 768/Math.max(w||1,h||1)), cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round((w||1)*k)); cv.height=Math.max(1,Math.round((h||1)*k)); cv.getContext('2d').drawImage(src,0,0,cv.width,cv.height); return cv.toDataURL('image/jpeg',0.85); }
function aaFrame(){   // image de la vidéo de référence (~0,6 s) pour mesurer le visage — échec = cadrage standard
  return new Promise(function(res){
    var v=aaVid&&aaVid.el; if(!v||!aaVidW){ res(''); return; }
    var t=Math.min(0.6, (aaVidDur||1)/2), done=false, fin=function(){ if(done) return; done=true; try{ res(aaSmall(v, aaVidW, aaVidH)); }catch(e){ res(''); } };
    v.onseeked=fin; try{ v.currentTime=t; }catch(e){ fin(); } setTimeout(fin, 4000);
  });
}
// = _mcPrepChar de l’app : ratio de la vidéo de réf (0,4–2,5), tête à la même fraction de hauteur que dans la réf
// (0,12–0,42 ; sinon 22 % centrée à 32 %), jamais de pixels inventés, côtés ≤ 2560 et ≥ 400.
function aaCrop(img, box, ref){
  var W=img.naturalWidth||1, H=img.naturalHeight||1;
  var ratio=Math.max(0.4, Math.min(2.5, (aaVidW>0&&aaVidH>0)?aaVidW/aaVidH:W/H));
  var cw=W, ch=Math.round(W/ratio); if(ch>H){ ch=H; cw=Math.round(H*ratio); }
  var sx=Math.round((W-cw)/2), sy=Math.min(Math.round((H-ch)/2), Math.round(H*0.08));
  if(box){
    var fcx=(box.x+box.w/2)*W, fcy=(box.y+box.h/2)*H, fpx=Math.max(8, box.h*H), hasRef=!!(ref&&ref.h>0);
    var headT=hasRef?Math.max(0.12,Math.min(0.42,ref.h)):0.22, cxT=hasRef?Math.max(0,Math.min(1,ref.x+ref.w/2)):0.5, cyT=hasRef?Math.max(0,Math.min(1,ref.y+ref.h/2)):0.32;
    var ch2=Math.round(fpx/headT); if(ch2>H) ch2=H;
    var cw2=Math.round(ch2*ratio); if(cw2>W){ cw2=W; ch2=Math.round(W/ratio); }
    sx=Math.max(0, Math.min(W-cw2, Math.round(fcx-cw2*cxT))); sy=Math.max(0, Math.min(H-ch2, Math.round(fcy-ch2*cyT))); cw=cw2; ch=ch2;
  }
  var k=Math.min(1, 2560/Math.max(cw,ch)); if(Math.min(cw,ch)*k<400) k=400/Math.min(cw,ch);
  var cv=document.createElement('canvas'); cv.width=Math.max(2,Math.round(cw*k)); cv.height=Math.max(2,Math.round(ch*k));
  cv.getContext('2d').drawImage(img, sx, sy, cw, ch, 0, 0, cv.width, cv.height);
  return aaJpeg(cv, 0.92);
}
function aaGo(){
  var p=Promise.resolve();
  if(aaTool==='motion'){
    p=p.then(function(){ aaMsg('Cadrage du personnage…'); return aaFrame(); })
      .then(function(refShot){ var cs=''; try{ cs=aaSmall(aaChar, aaChar.naturalWidth, aaChar.naturalHeight); }catch(e){ throw new Error('Photo illisible ici — dépose-la depuis ton ordinateur.'); } return aaPost('mc-face', { job:aaJobId, cap:aaCap, char:cs, ref:refShot }).catch(function(){ return { j:{} }; }); })
      .then(function(x){ return aaCrop(aaChar, x.j&&x.j.char, x.j&&x.j.ref); })
      .then(function(blob){ if(!blob) throw new Error('Préparation de la photo impossible.'); return aaUrl('char','image/jpeg',blob.size).then(function(u){ return aaPut(u, blob, 'image/jpeg', 'Envoi de la photo'); }); });
  }
  if(aaVid&&aaVid.file){ var f=aaVid.file, ty=f.type||'video/mp4'; p=p.then(function(){ return aaUrl(aaTool==='motion'?'ref':'video', ty, f.size); }).then(function(u){ return aaPut(u, f, ty, 'Envoi de la vidéo'); }); }
  return p.then(function(){ aaSent=true; return aaLance(); });
}
// /start seul (fichiers déjà au stockage) : 1er lancement, bouton « Relancer », relance auto quand la file est pleine
function aaLance(){
  aaMsg('Lancement…');
  return aaPost('start', { job:aaJobId, cap:aaCap, duration:aaVidDur||0 })
    .then(function(x){
      if(x.ok&&x.j.statusUrl){ aaOk=false; aaPct=5; aaLong=true; aaStartPoll(x.j.statusUrl); return; }
      var er=x.j.error||'';
      if(er==='not_pending'&&aaJobId){ aaOk=false; aaPct=5; aaLong=true; aaStartPoll('https://mcp.avatarads.fr/status/'+aaJobId); return; }
      aaBusy=false;
      if(er==='busy'&&aaRetryN<20){ aaRetryN++; aaMsg('Deux vidéos sont déjà en préparation — la carte relance toute seule dans quelques secondes…'); setTimeout(function(){ aaLance().catch(function(e){ aaMsg(String(e&&e.message||e)); }); }, 15000); return; }
      if(er==='no_credits'||er==='busy'){ aaRelancer(er==='no_credits'?'Crédits insuffisants — recharge sur avatarads.fr, puis relance.':'La file est encore pleine — relance dans un instant.'); return; }
      throw new Error(er==='bad_type'?'Fichier refusé (format ou poids).':er==='plan'?'Réservé aux plans Starter, Pro et Élite':er==='expired'?'Carte expirée — redemande à Claude.':er==='no_video'?'La vidéo n’est pas arrivée — redépose-la.':er==='no_char'?'La photo n’est pas arrivée — redépose-la.':'Échec ('+(er||'réseau')+') — réessaie.');
    });
}
function aaLikely(p){ return p&&(p.structuredContent||(p.content&&p.content.length)); }
function aaTheme(t){ try{ document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light'); }catch(e){} }
var aaReady=false, aaFinal=false, aaLW=0, aaLH=0, aaSched=false;
function aaMeasure(){
  if(aaSched) return; aaSched=true;
  requestAnimationFrame(function(){
    aaSched=false; if(!aaReady) return;
    var html=document.documentElement, oh=html.style.height;
    html.style.height='max-content';
    var h=Math.ceil(html.getBoundingClientRect().height);
    html.style.height=oh;
    // largeur = celle du média (aaHugW, calculée depuis ses dimensions réelles → jamais 0) ;
    // avant que le média soit chargé, on retombe sur le viewport (avec plancher). JAMAIS ~0
    // (sinon iframe à 0 → image « disparue » → tempête → 502).
    var w = aaHugW > 0 ? aaHugW : Math.max(200, Math.ceil(window.innerWidth || 360));
    if(w!==aaLW||h!==aaLH){ aaLW=w; aaLH=h;
      window.parent.postMessage({ jsonrpc:'2.0', method:'ui/notifications/size-changed', params:{ width:w, height:h } }, '*'); }
  });
}
function aaKick(){
  // hug par les DIMENSIONS DE L'IMAGE (réelles, jamais 0 → pas d'effondrement) : on cale
  // l'iframe pile sur la largeur d'affichage du média (hauteur max 620), donc aucune bande.
  try{ var _e=document.querySelector('#m video,#m img');
    if(_e){ var _nw=_e.videoWidth||_e.naturalWidth||0, _nh=_e.videoHeight||_e.naturalHeight||0;
      if(_nw>0&&_nh>0){ var _dh=Math.min(_nh,620); aaHugW=Math.max(240,Math.min(680,Math.round(_nw*_dh/_nh))); } } }catch(e){}
  aaMeasure();
}
function aaFinalize(){
  if(aaFinal) return; aaFinal=true;
  try{ window.parent.postMessage({ jsonrpc:'2.0', method:'ui/notifications/initialized', params:{} }, '*'); }catch(e){}
  aaReady=true;
  try{ var ro=new ResizeObserver(aaMeasure); ro.observe(document.documentElement); ro.observe(document.body); }catch(e){}
  aaMeasure(); setTimeout(aaMeasure,300); setTimeout(aaMeasure,1500);
}
window.addEventListener('message', function(e){
  if(e.source!==window.parent) return;   // audit 02/10 : seul l'hôte (claude.ai) parle à la carte
  var d=e.data||{};
  try{ aaSeen.push(d.method||d.type||(d.id!==undefined?'rep#'+d.id:'msg')); }catch(_){ }
  if(d.jsonrpc==='2.0'&&d.id===1&&d.result){
    try{ var hc=d.result.hostContext||{}; if(hc.theme) aaTheme(hc.theme); if(hc.toolInfo&&hc.toolInfo.result) aaShow(hc.toolInfo.result); }catch(_){ }
    aaFinalize(); return;
  }
  if(d.jsonrpc==='2.0'&&d.method&&d.id===undefined){
    if(d.method==='ui/notifications/tool-result') aaShow(d.params||{});
    else if(d.method==='ui/notifications/host-context-changed'&&d.params&&d.params.theme) aaTheme(d.params.theme);
    else if(aaLikely(d.params)) aaShow(d.params);
    return;
  }
  if(d.type==='ui-lifecycle-iframe-render-data'&&d.payload&&d.payload.renderData){
    var rd=d.payload.renderData; aaShow(rd.toolOutput||rd.toolResult||rd);
  }
});
window.parent.postMessage({ jsonrpc:'2.0', id:1, method:'ui/initialize', params:{
  capabilities:{}, clientInfo:{ name:'AvatarAds Media Viewer', version:'1.0.0' },
  appCapabilities:{ availableDisplayModes:['inline'] },
  appInfo:{ name:'AvatarAds Media Viewer', version:'1.0.0' },
  protocolVersion:'2026-01-26' } }, '*');
window.parent.postMessage({ type:'ui-lifecycle-iframe-ready' }, '*');
setInterval(aaKick, 1000);   // recalcule la largeur au format exact du média dès que ses dimensions sont connues
setTimeout(aaFinalize, 1200);
setTimeout(function(){ if(!aaOk && !aaPollT){ try{ var m=document.getElementById('m'); m.innerHTML='<div class="aa-pt" id="pt">AvatarAds — génération en cours…</div><div class="aa-pw"><div class="aa-pb" id="pb"></div></div>'; aaSetPct(8); var t0=Date.now(); var iv=setInterval(function(){ if(aaOk||aaPollT){ clearInterval(iv); return; } var e=(Date.now()-t0)/1000; aaSetPct(Math.min(92, 8+Math.round(84*(1-Math.exp(-e/70))))); }, 1500); aaKick(); }catch(e){} } }, 6000);   // Axel 01/10 : barre de progression sous le texte
`

const UI_VIEWER_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  /* ⚠ ANGLES BLANCS : claude.ai peint un fond BLANC derrière l'iframe → il transparaissait
     aux 4 coins arrondis de la carte (fond transparent). Fix = html/body OPAQUES et de la
     MÊME couleur que la carte (thème-aware) → les coins montrent la couleur de la carte,
     plus le blanc de l'hôte. Palette en variables : clair par défaut, sombre via
     [data-theme=dark] (posé par aaTheme) ET la préférence OS (garde :not([data-theme=light])). */
  :root{--aa-bg:#fff;--aa-fg:#1a1a1a;--aa-line:rgba(128,128,128,.28);--aa-btn:rgba(128,128,128,.16)}
  :root[data-theme=dark]{--aa-bg:#1f1f1f;--aa-fg:#ededed;--aa-line:rgba(255,255,255,.16);--aa-btn:rgba(255,255,255,.14)}
  @media (prefers-color-scheme:dark){:root:not([data-theme=light]){--aa-bg:#1f1f1f;--aa-fg:#ededed;--aa-line:rgba(255,255,255,.16);--aa-btn:rgba(255,255,255,.14)}}
  html,body{margin:0;background:var(--aa-bg);color:var(--aa-fg)}
  .aa-c{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    border:1px solid var(--aa-line);border-radius:16px;overflow:hidden;
    background:var(--aa-bg);color:var(--aa-fg);width:100%;box-sizing:border-box}
  #m a{display:block;font-size:0}
  #m{text-align:center;background:var(--aa-bg)}
  .aa-m{display:block;width:auto;max-width:100%;height:auto;max-height:620px;margin:0 auto;object-fit:contain;background:var(--aa-bg)}
  .aa-b{display:flex;align-items:center;gap:10px;padding:11px 13px;flex-wrap:wrap;
    border-top:1px solid var(--aa-line)}
  .aa-n{font-size:12.5px;font-weight:600;opacity:.9}
  .aa-a{font-size:13px;font-weight:700;text-decoration:none;padding:9px 16px;border-radius:10px;line-height:1;white-space:nowrap}
  .aa-dl{background:#FF5A1F;color:#fff}
  .aa-rg{background:var(--aa-btn);color:inherit}
  .aa-a:disabled{opacity:.55;cursor:default}
  .aa-pt{font-size:12.5px;opacity:.85;margin-bottom:2px}
  .aa-pw{height:6px;background:rgba(128,128,128,.22);border-radius:6px;overflow:hidden;margin:12px 0 2px}
  .aa-pb{height:100%;width:5%;background:#FF5A1F;border-radius:6px;transition:width .6s ease}
</style></head><body>
<div class="aa-c" id="c"><div id="m" style="padding:14px 13px;font-size:13px"><span style="opacity:.75">AvatarAds — chargement…</span></div>
<div class="aa-b" id="b" style="display:none"><button class="aa-a aa-rg" id="rg" type="button" style="border:none;cursor:pointer">↻ Regénérer</button><span style="flex:1"></span><button class="aa-a aa-dl" id="dl" type="button" style="border:none;cursor:pointer">Télécharger</button></div></div>
<script type="module" src="${WIDGET_ORIGIN}/widget.js"></script></body></html>`

// CSP du widget : sans `resourceDomains`, la sandbox de l'hôte bloque le
// chargement des images/vidéos externes dans l'iframe → carte vide (constaté
// au test OAuth du 15/08). L'origin Supabase sert tous les médias (mcp-media
// public + render-media signé), avatarads.fr sert les logos.
const SUPA_ORIGIN = (Deno.env.get('SUPABASE_URL') || 'https://guvwgiejzkiodghywpwj.supabase.co').replace(/\/$/, '')
// _meta.ui de la RESSOURCE — RÉDUIT à la forme officielle (video-resource-server).
// ⚠⚠ LA VRAIE CAUSE du « problème d'affichage » (trouvée le 16/08 dans le SDK
// officiel, src/spec.types.ts L704) : le champ `domain` est « Dedicated origin for
// view sandbox », dont « the format and validation rules are determined by each
// host » — claude.ai attend `{hash}.claudemcpcontent.com`, PAS un domaine à nous.
// Notre `domain: mcp.avatarads.fr` faisait échouer le sandbox de l'iframe →
// « problème d'affichage » → tempête de reconnexions. OMIS → claude.ai utilise son
// origine de sandbox par défaut (par conversation). On ne fait AUCUN appel CORS
// depuis l'iframe (juste un <img>), donc pas besoin de domaine stable.
// ★★★★★ VRAIE CAUSE FINALE (16/08 14h — console DevTools d'Axel) : le CSP du
// widget côté claude.ai BLOQUE le JS INLINE — « Refused to execute a script because
// its hash, its nonce, or 'unsafe-inline' does not appear in the script-src
// directive ». Donc `<script>${JS}</script>` inline ne tourne JAMAIS → handshake mort
// → rendu échoue → tempête. (Mon mock local mettait `'unsafe-inline'` → il passait à
// tort.) FIX = servir le JS en EXTERNE `<script src=WIDGET_ORIGIN/widget.js>` + mettre
// WIDGET_ORIGIN dans `resourceDomains` (→ mappe sur CSP `script-src`). C'est exactement
// le mécanisme de Pletor. `resourceDomains` reste OBLIGATOIRE aussi pour l'<img>
// Supabase (« omitted → no network resources »). PAS de `domain` (format host-
// spécifique, cassait le sandbox).
const UI_META = {
  ui: {
    csp: {
      connectDomains: [SUPA_ORIGIN, WIDGET_ORIGIN],
      resourceDomains: [WIDGET_ORIGIN, SUPA_ORIGIN, 'https://avatarads.fr'],
    },
  },
}

const UI_RESOURCES = ['image.html', 'video.html', 'avatar.html', 'montage.html'].map((n) => ({
  uri: `ui://avatarads/${n}`,
  name: `Viewer ${n}`,
  mimeType: 'text/html;profile=mcp-app',
  _meta: UI_META,
}))

const carteHtml = (url: string, nom: string, mime: string) => {
  const video = mime.startsWith('video')
  // Contrastes : la premiere version posait un libelle a 65 % d'opacite et un
  // bouton a bordure grise 35 % — sur le fond sombre de Claude, Axel ne voyait
  // ni l'un ni l'autre. Les couleurs sont maintenant declarees pour les DEUX
  // themes via prefers-color-scheme, et « Ouvrir » a un fond, pas un filet.
  // `#t=0.1` : le navigateur se cale sur la frame a 0,1 s et l'affiche comme
  // apercu. Sans ca le lecteur reste un rectangle noir tant qu'on n'a pas
  // appuye sur play — Axel : « pareil pour pas que le lecteur soit un
  // rectangle noir ». Aucune extraction serveur, aucun fichier en plus.
  const image = mime.startsWith('image')
  const media = video
    ? `<video src="${url}#t=0.1" controls playsinline preload="metadata" class="aa-m"></video>`
    : image
      ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="" class="aa-m" style="object-fit:contain"/></a>`
      : `<audio src="${url}" controls preload="metadata" class="aa-m" style="height:44px"></audio>`
  return `<style>
  .aa-c{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    border:1px solid rgba(128,128,128,.28);border-radius:16px;overflow:hidden;
    background:#fff;color:#1a1a1a;max-width:520px}
  .aa-m{width:auto;max-width:100%;height:auto;display:block;margin:0 auto;background:var(--aa-bg);max-height:70vh}
  .aa-b{display:flex;align-items:center;gap:10px;padding:11px 13px;flex-wrap:wrap;
    border-top:1px solid rgba(128,128,128,.22)}
  .aa-n{font-size:12.5px;font-weight:600;opacity:.9;font-variant-numeric:tabular-nums}
  .aa-a{font-size:13px;font-weight:700;text-decoration:none;padding:9px 16px;border-radius:10px;
    line-height:1;white-space:nowrap}
  .aa-dl{background:#FF5A1F;color:#fff}
  .aa-op{background:rgba(128,128,128,.16);color:inherit}
  @media (prefers-color-scheme:dark){
    .aa-c{background:#1f1f1f;color:#ededed;border-color:rgba(255,255,255,.16)}
    .aa-b{border-top-color:rgba(255,255,255,.12)}
    .aa-op{background:rgba(255,255,255,.14)}
  }
</style>
<div class="aa-c">
  ${media}
  <div class="aa-b">
    <span class="aa-n">${nom}</span>
    <a class="aa-a aa-dl" href="${url}" download="${nom}" style="margin-left:auto">T&#233;l&#233;charger</a>
    ${video ? `<a class="aa-a aa-op" href="${APP_URL}?video=${encodeURIComponent(url)}&nom=${encodeURIComponent(nom)}" target="_blank" rel="noopener">Ouvrir dans l&#39;&#201;diteur</a>` : ''}
    <a class="aa-a aa-op" href="${url}" target="_blank" rel="noopener">Ouvrir</a>
  </div>
</div>`
}

// ── FAIRE APPARAÎTRE LE MÉDIA, PAS SON URL ──────────────────────────────────
// J'avais affirmé qu'aucun serveur MCP ne pouvait afficher une vidéo dans la
// conversation. Faux : Higgsfield le fait. Axel m'a montré sa carte — lecteur,
// boutons Download / Recreate, icône `</>` — c'est un WIDGET HTML, pas un lien.
// Le client rend une ressource embarquée `text/html` dans une iframe ; c'est
// l'iframe qui va chercher le MP4 à son URL, donc AUCUN base64 : le problème du
// poids (21 Mo pour un montage) disparaît.
// On envoie les trois formes, de la plus riche à la plus sobre : le widget, le
// lien de ressource, puis le texte. Un client qui ignore la première tombe sur
// la suivante — on ne parie pas sur une seule.
// ── « COMME HIGGSFIELD » (31/07, demande d'Axel) ────────────────────────────
// Ce que fait réellement Higgsfield pour qu'un média « s'affiche dans le MCP » :
// (1) un bloc `image` MCP (base64) — les clients Claude le rendent nativement
// dans la carte de l'outil ; (2) demander AU MODÈLE d'écrire le markdown
// `![...](url)` — c'est le seul chemin pour que le visuel descende dans le FIL
// de la conversation (le rendu inline des ressources y est cassé côté client,
// cf. anthropics/claude-ai-mcp#238 — on contourne, on ne re-creuse pas).
// La vidéo n'a pas de bloc MCP : sa VIGNETTE (mcp_jobs.preview_url, 640 px)
// joue ce rôle, et le fil affiche vignette-image + lien cliquable vers le MP4.
const toolMedia = async (url: string, nom: string, mime: string, texte: string, apercuUrl?: string): Promise<ToolContent> => {
  { const brut = url; url = await signMedia(url); if (url !== brut) texte = texte.split(brut).join(url) }   // mcp-media privé (audit 28/09)
  // Bilan 16/08 : le widget ne se rend pas → on garde la VIGNETTE (bloc image),
  // seul visuel fiable, visible en dépliant la carte.
  const contenu: Array<Record<string, unknown>> = []
  const estVideo = mime.startsWith('video/')
  const vignette = apercuUrl ? await blocImage(apercuUrl) : null
  if (vignette) contenu.push(vignette)
  contenu.push({ type: 'resource_link', uri: url, name: nom, mimeType: mime, description: nom })
  const consigne = estVideo
    ? `\n\nDonne l'URL en lien cliquable [▶ Voir la vidéo](${url}). N'affiche PAS la vidéo en markdown ni en artifact (le bac à sable bloque les URL externes).`
    : ''
  contenu.push({ type: 'text', text: texte + consigne })
  return { content: contenu,
    structuredContent: { url, kind: estVideo ? 'video' : 'audio', name: nom } }
}

// ── Définition des outils ──
// `isOwner` = compte illimité (owner OU plan developer) : options internes de test. `isAdmin` = is_owner seul (audit 02/10) :
// les outils ADMIN (fiche d'un autre utilisateur, backlog des animations) ne sont plus montrés au plan developer.
function toolDefs(isOwner: boolean, requireConfirm = true, isAdmin = false) {
  const tools: Array<Record<string, unknown>> = [
    {
      name: 'get_account',
      description: 'Infos du compte AvatarAds connecté : plan, crédits restants, barème des coûts en crédits.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'generate_image',
      description: `Génère une image IA (moteur AvatarAds, gpt-image) : visuel libre, STATIC AD (pub produit avec titre, bénéfices, marque) ou photo UGC (personne qui tient le produit). 🧠 POUR UNE STATIC AD, C'EST TOI QUI ÉCRIS LA COPIE : d'après ce que le produit EST (le lien produit, ce que l'utilisateur t'a dit), rédige un vrai titre accrocheur + 2 à 4 bénéfices VRAIS + un CTA + la marque — des arguments réels et cohérents, jamais inventés. Un format pro est ensuite choisi au hasard et gpt-image le met en forme. ⛔ N'écris AUCUN texte autour de l'appel (la carte affiche le résultat) et ne consulte pas la page produit toi-même : passe son lien dans product_url. Coût : ${IMG_COST.standard} crédits en qualité standard, ${IMG_COST.high} en high. ⚠️ Qualité par défaut = TOUJOURS 'standard'. 📷 PHOTO DU PRODUIT (reproduite à l'identique), par ordre de préférence : (1) si tu as CONSULTÉ la page produit et vois l'URL de l'image principale (og:image, souvent un lien cdn.shopify.com/CDN) → passe-la dans reference_image_url (marche même si la page bloque notre serveur) ; (2) sinon l'utilisateur colle le LIEN de page → product_url (extraction auto, repli dépôt si le site est protégé) ; (3) rien de tout ça → appelle quand même l'outil, la CARTE gère (dépôt/lien/« Sans photo »). no_reference:true seulement pour un produit inventé.`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "Description de l'image (sujet, ambiance, lumière, cadrage…). Pour kind='static_ad', décris le produit, la couleur dominante et l'ambiance — les TEXTES vont dans headline/subheadline/bullets/brand/cta." },
          kind: { type: 'string', enum: ['free', 'static_ad', 'ugc'], description: "'static_ad' = publicité statique produit (titre + sous-titre + bénéfices + marque, le produit est le héros) · 'ugc' = photo selfie/UGC d'une personne QUI TIENT UN PRODUIT — à n'utiliser QUE s'il y a réellement un produit (photo/lien fournis, ou produit décrit) ; une personne/un selfie/un influenceur SANS produit = 'free', PAS 'ugc' (sinon un produit fantôme est ajouté) · 'free' (défaut) = prompt libre, aucun produit n'est ajouté s'il n'est pas décrit." },
          reference_image_url: { type: 'string', description: "URL http(s) DIRECTE de l'image du produit (…/xxx.jpg|png|webp, ≤ 10 Mo) à reproduire à l'identique. ASTUCE : si tu as déjà consulté la page produit et que tu vois l'URL de l'image principale (souvent un lien cdn.shopify.com ou autre CDN dans la balise og:image), passe-la ICI — elle fonctionne même quand la page bloque notre serveur." },
          product_url: { type: 'string', description: "LIEN de la page produit (Shopify, site e-commerce, ou lien direct vers l'image) : la photo principale est récupérée automatiquement et reproduite à l'identique. À utiliser dès que l'utilisateur colle un lien." },
          no_reference: { type: 'boolean', description: "true = générer directement SANS photo du produit (l'utilisateur n'en a pas ou veut un produit inventé). Sinon la carte demande la photo." },
          headline: { type: 'string', description: "static_ad : titre accrocheur, FRANÇAIS, 2 à 6 mots (ex. « LE GOÛT DU BIEN-ÊTRE »)." },
          subheadline: { type: 'string', description: "static_ad : sous-titre d'une ligne (ex. « Kombucha bio aux fruits rouges. Naturellement fermenté. »)." },
          bullets: { type: 'array', items: { type: 'string' }, description: "static_ad : 3 bénéfices courts (2 à 4 mots chacun), chacun aura une icône." },
          brand: { type: 'string', description: "static_ad : nom de la marque, tel qu'écrit sur le produit." },
          cta: { type: 'string', description: "static_ad : accroche finale courte (ex. « Pétillant. Sain. Délicieux. »)." },
          quote: { type: 'string', description: "static_ad : témoignage / message / paragraphe en FRANÇAIS pour les formats qui en ont un (avis, reddit, message, email, story, annonce…)." },
          number: { type: 'string', description: "static_ad : chiffre clé (ex. « 85% », « 10 ») pour les formats statistiques / X signes." },
          format: { type: 'string', enum: ['portrait', 'square', 'landscape'], description: 'portrait 9:16 (défaut, idéal TikTok/Reels), square 1:1, landscape 16:9' },
          quality: { type: 'string', enum: ['premium', 'standard', 'high'], description: `'premium' = DÉFAUT (${IMG_COST.standard} crédits) — OMETS ce paramètre ou mets 'premium' dans tous les autres cas. Change-le UNIQUEMENT si l'utilisateur le demande lui-même : 'standard' (${IMG_COST.low} crédit, éco) s'il dit « standard / éco / moins cher », 'high' (${IMG_COST.high} crédits) s'il dit « haute qualité / HD / 4K ». Ne choisis jamais un autre niveau parce que le prompt dit « détaillé », « réaliste » ou « ultra ».` },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['prompt'],
      },
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // widget = 1 SEULE carte : barre de progression → image + boutons (le widget SONDE statusUrl lui-même, plus de spam check_image)
    },
    {
      name: 'generate_video',
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // widget : barre de progression → vidéo EN GRAND inline + Télécharger. Le widget SONDE statusUrl et /status avance le job → plus besoin de check_video (donc plus de « Impossible de joindre » via le proxy)
      description: `Le module EXPRESS d'AvatarAds : génère une vidéo IA (audio et dialogues inclus) à partir d'un prompt et, en option, d'une image de départ (image_url). Coût : 5 crédits/seconde, en 4, 6, 8 ou 10 s (défaut 6), 1080p. Avec une image de départ (image_url, ou photo déposée via user_photo) : c'est tout. SANS aucune image : une photo de départ est d'abord générée d'après le prompt (+3 crédits), puis animée — ex. 6 s sans image = 33 crédits. Lance DIRECTEMENT, sans devis ni demande d'accord ; le coût peut être cité en une phrase après le lancement. Débité au lancement (remboursé si échec). La vidéo s'affiche TOUTE SEULE dans la carte (barre de progression puis lecteur) — n'appelle PAS check_video. 📷 PHOTO DE DÉPART : claude.ai NE TRANSMET PAS les images jointes au chat — tu ne reçois jamais la photo déposée dans la conversation. Si l'utilisateur a joint une ou plusieurs photos et veut en faire des vidéos : appelle generate_video avec user_photo:true (UN appel par vidéo, sans image_url) — la CARTE affiche une zone où il dépose sa photo, puis la vidéo se lance toute seule (tarif avec image : 5 crédits/seconde). Ne l'envoie PAS sur le site, ne lui demande pas de lien. Si tu as déjà une URL (image générée par generate_image dans cette conversation, lien collé) : passe-la dans image_url, sans user_photo. ⛔ Ne nomme JAMAIS le moteur technique sous-jacent à l'utilisateur : parle du « module Express d'AvatarAds ».`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "Description de la vidéo : scène, mouvement, ambiance. La réplique parlée s'écrit EN FRANÇAIS entre guillemets « … » (c'est exactement ce que la personne dira, mot pour mot ; l'avatar parle toujours français). ⏱ Elle DOIT tenir dans la durée avec une demi-seconde de silence à la fin : 2 mots par seconde AU MAXIMUM — 4 s ≈ 7 mots, 6 s ≈ 11 mots, 8 s ≈ 15 mots, 10 s ≈ 19 mots. Trop longue = coupée en pleine phrase : raccourcis-la ou choisis une durée plus longue." },
          duration_seconds: { type: 'integer', enum: [4, 6, 8, 10], description: 'Durée en secondes : 4, 6, 8 ou 10 (défaut 6). Une autre valeur est arrondie au cran supérieur et facturée à ce cran.' },
          product_url: { type: 'string', description: "Lien de la PAGE PRODUIT quand l'utilisateur veut une vidéo d'une personne qui présente ce produit : passe-le ici, dans CE seul appel (pas de generate_image avant). La photo OFFICIELLE du produit est récupérée côté serveur, la photo de départ est générée avec ce produit en main (+3 crédits), puis la vidéo se lance — tout dans la même carte. Si le site bloque la récupération (Louis Vuitton, Dior, Chanel…), la carte le dit et demande de déposer la photo du produit : on n'invente JAMAIS le produit." },
          user_photo: { type: 'boolean', description: "true quand l'utilisateur veut partir d'une photo qu'il a JOINTE AU CHAT (que tu ne peux pas transmettre) : la carte lui propose de la déposer, puis lance la vidéo. Un appel par photo / par vidéo. Ne l'utilise pas si tu as déjà une URL (image_url)." },
          aspect_ratio: { type: 'string', enum: ['9:16', '16:9'], description: '9:16 vertical (défaut) ou 16:9 paysage.' },
          image_url: { type: 'string', description: "URL publique http(s) d'une image de départ (optionnel) : une image de generate_image, ou un lien collé par l'utilisateur. ⚠️ claude.ai ne transmet PAS les images jointes au chat : pour une photo JOINTE, n'utilise pas image_url, mets user_photo:true (la carte la lui fait déposer)." },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'edit_video',
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // carte : dépôt de la vidéo → progression → vidéo transformée + Télécharger
      description: `Le module OMNI d'AvatarAds : transforme une VIDÉO EXISTANTE avec un prompt (« change la voiture en Bugatti », « mets-lui une veste en cuir », « transforme le décor en plage »…) — le reste de la vidéo (personnes, mouvement, son, cadrage) est gardé à l'identique. UN seul changement par appel (les prompts simples marchent le mieux). Vidéo de 1 à 10 s (plus longue : seules les 10 premières secondes sont gardées). Coût : ${OMNI_EDIT_SEC['720p']} crédits/seconde en 720p, ${OMNI_EDIT_SEC['1080p']} en 1080p ; durée arrondie à la seconde supérieure ; débité au lancement (rendu si échec). ❓ AVANT D'APPELER (Axel) : si le message ne précise PAS la qualité, pose d'abord UNE seule question courte — « 720p (3 crédits/s) ou 1080p (4 crédits/s) ? » — attends la réponse, puis appelle l'outil (une info déjà donnée ne se redemande pas). ⛔ Ne demande JAMAIS la durée : tu ne vois pas la vidéo ; la carte la mesure et prévient elle-même l'utilisateur si elle dépasse 10 s. duration_seconds uniquement si l'utilisateur demande DE LUI-MÊME de ne garder que ses N premières secondes. Ensuite plus aucune question : la carte fait le reste.  🎬 LA VIDÉO : claude.ai NE TRANSMET PAS les vidéos jointes au chat → appelle l'outil SANS video_url : la CARTE demande à l'utilisateur de déposer sa vidéo et lance la transformation toute seule. video_url seulement pour une vidéo déjà en ligne (ex. une vidéo AvatarAds générée dans cette conversation). Pas de devis ; n'appelle aucun check ensuite (la carte suit la génération). ⛔ Ne nomme JAMAIS le moteur technique : parle du « module Omni d'AvatarAds ».`,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "LA transformation à faire, en une phrase simple (français ou anglais) : quoi changer et en quoi. Ex. « Transforme la voiture en Lamborghini Huracán jaune. » Ne décris pas ce qui doit rester identique (c'est ajouté automatiquement)." },
          quality: { type: 'string', enum: ['720p', '1080p'], description: `Qualité CHOISIE PAR L'UTILISATEUR (demande-la si elle n'est pas dans son message) : '720p' (${OMNI_EDIT_SEC['720p']} cr/s) ou '1080p' (${OMNI_EDIT_SEC['1080p']} cr/s).` },
          duration_seconds: { type: 'integer', minimum: 1, maximum: 10, description: "Optionnel : ne garder que les N PREMIÈRES secondes de la vidéo (1 à 10). Omis = toute la vidéo, 10 s au plus." },
          video_url: { type: 'string', description: "Optionnel : URL http(s) d'une vidéo DÉJÀ en ligne (MP4/MOV, 60 Mo max), ex. une vidéo AvatarAds de cette conversation. Pour une vidéo jointe au chat : ne mets rien, la carte la fait déposer." },
        },
        required: ['prompt', 'quality'],
      },
    },
    {
      name: 'motion_control',
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // carte : photo + vidéo de référence → progression → vidéo + Télécharger
      description: `Le module MOTION CONTROL d'AvatarAds : un PERSONNAGE (une photo) reproduit EXACTEMENT les mouvements, gestes, expressions et mouvements de caméra d'une VIDÉO DE RÉFÉRENCE (danse, trend TikTok, présentation produit filmée par l'utilisateur…), avec le son de la référence. Le visage, la tenue et le décor viennent de la PHOTO. Vidéo de référence de 3 à 30 s (plus longue : les 30 premières secondes). Coût par seconde de la référence : Motion 2.6 en 720p = ${MC_SEC.std} cr/s, Motion 2.6 en 1080p = ${MC_SEC.hd} cr/s, Motion 3.0 (1080p natif, meilleur rendu) = ${MC_SEC.v3} cr/s — 1080p et 3.0 réservés aux plans Pro & Élite. Débité au lancement (rendu si échec). Compte 3 à 10 min. ❓ AVANT D'APPELER (Axel) : si le message ne précise PAS le modèle et la qualité, pose d'abord UNE seule question courte — « Motion 2.6 en 720p (2 crédits/s), 2.6 en 1080p (3 crédits/s) ou Motion 3.0 (6 crédits/s, Pro & Élite) ? » — attends la réponse, puis appelle l'outil (une info déjà donnée ne se redemande pas). ⛔ Ne demande JAMAIS la durée : tu ne vois pas la vidéo ; la carte la mesure et prévient elle-même l'utilisateur si elle dépasse 30 s. duration_seconds uniquement si l'utilisateur demande DE LUI-MÊME de ne garder que ses N premières secondes. Ensuite plus aucune question : la carte fait le reste.  📷🎬 LES FICHIERS : claude.ai NE TRANSMET PAS les photos ni les vidéos jointes au chat → appelle l'outil SANS image_url ni video_url : la CARTE demande la photo du personnage et la vidéo de référence, ajuste le cadrage toute seule et lance la génération. image_url seulement pour une image déjà en ligne (ex. un avatar créé avec generate_image dans cette conversation — très bon combo : créer l'avatar puis l'animer). Pas de devis ; n'appelle aucun check ensuite. ⛔ Ne nomme JAMAIS le moteur technique : parle du « module Motion Control d'AvatarAds ».`,
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', enum: ['2.6', '3.0'], description: `Modèle CHOISI PAR L'UTILISATEUR (demande-le s'il n'est pas dans son message) : '2.6' ou '3.0' (${MC_SEC.v3} cr/s, 1080p natif, Pro & Élite).` },
          quality: { type: 'string', enum: ['720p', '1080p'], description: `Qualité CHOISIE PAR L'UTILISATEUR : pour Motion 2.6, '720p' (${MC_SEC.std} cr/s) ou '1080p' (${MC_SEC.hd} cr/s, Pro & Élite). Motion 3.0 = toujours '1080p'.` },
          duration_seconds: { type: 'integer', minimum: 4, maximum: 30, description: "Optionnel : ne garder que les N PREMIÈRES secondes de la vidéo de référence (4 à 30). Omis = toute la vidéo, 30 s au plus." },
          instruction: { type: 'string', description: "Optionnel, rarement utile : consigne de mouvement en anglais qui REMPLACE la consigne par défaut (« reproduis exactement le mouvement et la caméra de la référence »). Laisse vide sauf demande précise de l'utilisateur." },
          realistic_camera: { type: 'boolean', description: "Caméra tenue à la main, légèrement vivante, façon selfie (DÉFAUT true, comme l'app). false = plan plus stable." },
          image_url: { type: 'string', description: "Optionnel : URL http(s) d'une photo DÉJÀ en ligne du personnage (ex. résultat de generate_image). Pour une photo jointe au chat : ne mets rien, la carte la fait déposer." },
          video_url: { type: 'string', description: "Optionnel : URL http(s) DIRECTE d'un fichier vidéo MP4/MOV déjà en ligne, 60 Mo max (pas un lien TikTok/Instagram : ceux-là ne se téléchargent pas — l'utilisateur dépose alors la vidéo dans la carte)." },
        },
        required: ['model', 'quality'],
      },
    },
    {
      name: 'check_image',
      _meta: { ui: { resourceUri: 'ui://avatarads/image.html' } },   // widget = image EN GRAND inline (le désactiver ne donne qu'un lien de téléchargement) ; HTML sans script inline, les erreurs CSP Safari viennent du host claude.ai, pas de nous
      description: "⚠️ NORMALEMENT INUTILE : après generate_image, l'image s'affiche TOUTE SEULE dans la carte (widget + barre de progression), tu n'as RIEN à faire. N'appelle check_image QUE si l'utilisateur redemande explicitement le statut. (Sinon : retourne l'URL de l'image quand prête ; long-poll côté serveur.)",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par generate_image. OMETS-le pour récupérer la dernière image du compte (après une erreur de relais ou une carte absente).' } },
        
      },
    },
    {
      name: 'check_video',
      _meta: { ui: { resourceUri: 'ui://avatarads/video.html' } },
      description: "Statut/affichage d'une vidéo Express. NORMALEMENT INUTILE : après generate_video la vidéo s'affiche TOUTE SEULE dans la carte. Deux cas d'appel : (1) l'utilisateur redemande le statut → passe le job_id ; (2) generate_video a renvoyé une erreur de connexion (« Impossible de joindre ») → appelle-le SANS job_id, ça récupère et affiche la dernière vidéo (ne relance PAS generate, ça débiterait 2 fois).",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par generate_video. OMETS-le pour récupérer la dernière vidéo du compte (après une erreur de connexion).' } },
      },
    },
    {
      name: 'check_avatar_video',
      _meta: { ui: { resourceUri: 'ui://avatarads/avatar.html' } },
      description: "Statut/affichage d'une vidéo avatar parlant. NORMALEMENT INUTILE : après generate_avatar_video la vidéo s'affiche TOUTE SEULE dans la carte. Deux cas d'appel : (1) l'utilisateur redemande le statut → passe le job_id ; (2) generate_avatar_video a renvoyé une erreur de connexion (« Impossible de joindre ») → appelle-le SANS job_id, ça récupère et affiche la dernière vidéo (ne relance PAS generate, ça débiterait 2 fois).",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par generate_avatar_video. OMETS-le pour récupérer la dernière vidéo du compte (après une erreur de connexion).' } },
      },
    },
    {
      name: 'clean_audio',
      description: `Nettoie la voix d'un fichier audio (le Nettoyage audio AvatarAds) : voix nettoyée (bruit de fond, souffle, clics). Fait pour une prise de voix — ne sépare pas une voix d'une musique de fond. 10 min d'audio au plus. Coût : ${CLEAN_COST_PER_MIN} crédit par minute d'audio (durée mesurée sur le fichier). Retourne l'URL du MP3 nettoyé.`,
      inputSchema: {
        type: 'object',
        properties: {
          audio_url: { type: 'string', description: 'URL publique du fichier audio à nettoyer (MP3, WAV, M4A, FLAC, OGG / Opus, WebM ou AAC — 15 Mo max).' },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['audio_url'],
      },
    },
    {
      name: 'lipsync_video',
      description: `LIPSYNC sur un audio EXISTANT (brique du mode avatar du Montage IA, #149) : ta photo d'avatar + un segment audio (ta vraie voix) → un clip vidéo où l'avatar parle cet audio, en synchro labiale. Deux qualités (paramètre engine) : standard (${LIPSYNC_COST_SEC} crédits/s, défaut) ou haute résolution (${OMNI_COST_SEC} crédits/s, plan plus large). Débité au lancement, remboursé si échec. Retourne un job_id — appelle ensuite check_avatar_video (compte 2 à 5 minutes).`,
      inputSchema: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: "URL publique de la photo de l'avatar (PNG/JPEG/WebP)." },
          audio_url: { type: 'string', description: "URL publique du SEGMENT audio exact à faire parler (WAV PCM ou MP3, max 60 s) — le clip sortant a la même durée." },
          engine: { type: 'string', enum: ['omnihuman', 'hedra'], description: `Qualité : 'hedra' = standard (défaut, ${LIPSYNC_COST_SEC} cr/s) · 'omnihuman' = haute résolution 1088×1920 (${OMNI_COST_SEC} cr/s).` },
          aspect_ratio: { type: 'string', enum: ['9:16', '1:1', '16:9'], description: '9:16 vertical (défaut).' },
          model: { type: 'string', enum: ['hedra-avatar', 'hedra-character-3', 'minimax-h3', 'minimax-h3-max-turbo', 'kling-ai-avatar-v2'], description: "Interne (engine 'hedra' uniquement) : modèle Hedra v3. Défaut hedra-character-3. minimax-h3 (768p, audios[], durée 5-15 s) et kling-ai-avatar-v2 (720p) = alternatives image+audio pour comparaison qualité." },
          ...(isOwner ? { prompt: { type: 'string', description: "Interne/dev : remplace le prompt avatar par défaut (A/B test qualité, ex. préservation cheveux/peau). Vide → prompt par défaut." } } : {}),
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['image_url', 'audio_url'],
      },
    },
    {
      name: 'montage_ia',
      description: `Le MONTAGE IA d'AvatarAds : à partir d'un simple AUDIO (voix parlée), la voix est d'abord NETTOYÉE (bruit de fond, souffle, clics), puis le chef d'orchestre transcrit, analyse et génère un plan de montage complet (slides motion-design, zooms, sous-titres mot à mot, bruitages), et le moteur de rendu serveur produit le MP4 final 1080×1920. Coût : ${MONTAGE_PLAN_COST + MONTAGE_RENDER_COST} crédits + ${CLEAN_COST_PER_MIN} crédit par minute de nettoyage, débités au lancement (remboursés si échec) ; avec lipsync, les secondes de visage sont débitées au moment de leur génération (lipsync standard 2 cr/s, lipsync haute résolution 5 cr/s ; jamais pour une scène déjà en cache). Retourne un job_id — appelle ensuite check_montage (compte 2 à 5 minutes).`,
      inputSchema: {
        type: 'object',
        properties: {
          audio_url: { type: 'string', description: "URL publique de l'audio (voix) : WAV, MP3, M4A, FLAC, OGG / Opus, WebM ou AAC, 20 Mo max. Une prise brute convient — elle est nettoyée automatiquement." },
          clean_audio: { type: 'boolean', description: "Optionnel, true par défaut : voix nettoyée (bruit de fond, souffle, clics) AVANT le montage. Ne mets false que si l'audio a DÉJÀ été traité — renettoyer un fichier propre ne l'améliore pas." },
          avatar_url: { type: 'string', description: "Optionnel — URL publique de la PHOTO d'avatar (PNG/JPEG). Par défaut elle est posée TELLE QUELLE sur les moments où la personne s'adresse à la caméra : aucun crédit en plus. Passe `lipsync: true` pour que le visage parle vraiment. Sans photo, le montage se fait sans visage." },
          avatar_urls: { type: 'array', maxItems: 5, items: { type: 'string' }, description: "Optionnel — d'AUTRES photos du MÊME personnage (autres angles/tenues), URLs publiques PNG/JPEG. Le montage pose une image DIFFÉRENTE à chaque fois que l'avatar réapparaît (rotation, façon vidéo virale) : le hook prend avatar_url, les fenêtres suivantes celles-ci. Aucun crédit en plus." },
          lipsync: { type: 'boolean', description: "Optionnel, false par défaut : anime le visage (lipsync standard) sur CHAQUE fenêtre où la personne parle — scène par scène, jamais sur toute la vidéo. Coûte 2 crédits par seconde de visage (débités à la génération). Sans lui, la photo reste fixe : c'est le mode économique pour itérer sur le montage." },
          lipsync_model: { type: 'string', enum: ['hedra', 'omnihuman', 'mix'], description: "Optionnel, 'hedra' par défaut (standard, économique). 'omnihuman' = haute résolution : plan plus large, les deux mains visibles, cheveux sans effet plastique, 50 i/s — ~5 crédits par seconde de visage. 'mix' = haute résolution sur le PREMIER passage avatar (le hook, là où l'attention se joue) puis standard sur les suivants : le meilleur rapport qualité/prix. Ne s'applique que si lipsync est activé." },
          media: {
            type: 'array', maxItems: 7,
            description: "Optionnel — jusqu'à 7 images/vidéos de l'utilisateur à placer dans le montage. Le chef d'orchestre les pose au moment que leur NOM décrit (nomme-les par ce qu'elles montrent : « resultat-image-ia-femme-lunettes.png », « demo-produit.mp4 »).",
            items: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'URL publique du fichier (PNG/JPEG/WebP/MP4), 20 Mo max.' },
                name: { type: 'string', description: "Ce que le média MONTRE, en clair — c'est ce qui guide son placement." },
              },
              required: ['url'],
            },
          },
          style: { type: 'string', enum: MONTAGE_STYLES, description: "Style visuel des slides : dynamic (motion design continu, défaut), apple (épuré clair), glass (liquid glass), word (mot par mot), auto (choisi par l'IA)." },
          brief: { type: 'string', description: "Optionnel — ce que l'utilisateur veut mettre en avant (intention, produit, CTA). 700 caractères max." },
          script: { type: 'string', description: 'Optionnel — texte EXACT du script parlé : garantit des sous-titres parfaits.' },
          duration_seconds: { type: 'number', description: "Optionnel — durée exacte de l'audio en secondes (sinon estimée automatiquement)." },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['audio_url'],
      },
    },
    {
      name: 'check_montage',
      _meta: { ui: { resourceUri: 'ui://avatarads/montage.html' } },
      description: "Vérifie l'état d'un Montage IA lancé avec montage_ia (ou render_montage_plan) et retourne l'URL du MP4 final quand il est prêt. Si toujours en cours, rappelle cet outil ~1 minute plus tard.",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id retourné par montage_ia ou render_montage_plan.' } },
        required: ['job_id'],
      },
    },
    {
      name: 'get_montage_plan',
      description: "LES DÉTAILS DU MONTAGE : renvoie le LIEN qui ouvre l'écran « Détails du montage » d'AvatarAds sur ce montage — l'utilisateur y retrouve la bande, les aperçus d'animations, le remplacement au swipe et la régénération. Donne-lui ce lien tel quel. Renvoie aussi le plan JSON si tu préfères le retoucher directement puis appeler render_montage_plan. Gratuit.",
      inputSchema: {
        type: 'object',
        properties: { job_id: { type: 'string', description: 'Le job_id du montage dont tu veux le plan.' } },
        required: ['job_id'],
      },
    },
    {
      name: 'render_montage_plan',
      description: `L'ÉDITEUR via Claude (rendu) : re-rend un Montage IA à partir d'un PLAN MODIFIÉ (obtenu via get_montage_plan puis ajusté : textes, timings, styles, coupes…). Réutilise l'audio du montage d'origine. Coût : ${MONTAGE_RENDER_COST} crédits. Retourne un nouveau job_id — appelle ensuite check_montage.`,
      inputSchema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: "Le job_id du montage D'ORIGINE (son audio est réutilisé)." },
          plan: { type: 'string', description: "Le plan de montage complet, en JSON (chaîne) — version modifiée de celui retourné par get_montage_plan. Pour retoucher des SCÈNES précises, ajoute-lui les champs de l'éditeur : userSlides (remplacer/ajouter une animation : [{start, end, anim, user:true, items:[{t, text}]}]), userBans (supprimer une scène : [{start, end}] — l'avatar reprend la fenêtre), userSfx (la liste FINALE des bruitages : [{t, kind, vol}]). Ces trois champs passent outre les garde-fous de la dérivation : un choix explicite n'est jamais rejeté." },
          confirm: { type: 'boolean', description: "Mets true UNIQUEMENT après avoir montré le devis (coût en crédits) à l'utilisateur et obtenu son accord explicite." },
        },
        required: ['job_id', 'plan'],
      },
    },
    {
      name: 'list_media',
      description: "Liste les derniers médias générés via Claude sur ce compte (images, vidéos) avec leurs URLs publiques — une image listée peut servir de reference_image_url à generate_image.",
      inputSchema: { type: 'object', properties: {} },
    },
  ]
  if (isAdmin) {
    tools.push({
      name: 'admin_find_user',
      description: "ADMIN (SAV) — fiche d'un utilisateur AvatarAds par e-mail : plan, crédits, quotas, parrainage, Whop, derniers e-mails envoyés. Lecture seule.",
      inputSchema: {
        type: 'object',
        properties: { email: { type: 'string', description: "E-mail de l'utilisateur recherché." } },
        required: ['email'],
      },
    })
    tools.push({
      name: 'animations_demandees',
      description: "ADMIN — ce qui MANQUE à la banque d'animations du Montage IA, classé par nombre de demandes. Chaque ligne vient d'un montage réel où le chef d'orchestre n'a rien trouvé à montrer. Sert à décider quelles animations fabriquer en premier. Lecture seule.",
      inputSchema: {
        type: 'object',
        properties: {
          limite: { type: 'number', description: 'Nombre de mots à remonter (défaut 20).' },
          depuis_jours: { type: 'number', description: "Ne compter que les demandes des N derniers jours (défaut : tout)." },
        },
      },
    })
  }
  // ── QUAND LE DEVIS EST DÉSACTIVÉ, ON RETIRE `confirm` DES SCHÉMAS ─────────
  // Axel avait décoché « demander confirmation » (require_confirm = false en
  // base, le serveur ne réclamait donc rien) et Claude lui demandait quand même
  // son accord : on continuait à ANNONCER un paramètre confirm dont la consigne
  // dit « montre le devis et attends l'accord explicite ». Le modèle obéit à la
  // description, pas au réglage. Un paramètre qu'on ne veut pas voir utilisé ne
  // doit pas exister dans le schéma.
  if (!requireConfirm) {
    for (const t of tools) {
      const props = ((t.inputSchema as Record<string, unknown> | undefined)?.properties) as Record<string, unknown> | undefined
      if (props) delete props.confirm
    }
  }
  return tools
}

// ── Implémentation des outils ──
async function runGetAccount(profile: Record<string, unknown>): Promise<ToolContent> {
  const credits = isUnlimited(profile) ? '∞ (compte développeur)' : String(profile.credits_remaining ?? 0)
  return toolText(
    `Compte AvatarAds
- E-mail : ${profile.email}
- Prénom : ${profile.first_name || '—'}
- Plan : ${profile.plan || 'free'}
- Crédits restants : ${credits}

Barème : image Premium (défaut) ${IMG_COST.standard} crédits · Standard éco ${IMG_COST.low} crédit · Haute qualité ${IMG_COST.high} crédits · vidéo Express ${OMNI_FLASH_SEC} crédits/s (4, 6, 8 ou 10 s ; +${OMNI_START_IMG} crédits pour la photo de départ si aucune image n'est fournie) · avatar parlant (voix native) Standard ${VIDEO_COST_SEC} / Pro ${VIDEO_COST_SEC_PRO} crédit/s (4 à 8 s) · nettoyage audio ${CLEAN_COST_PER_MIN} crédit/min · Montage IA ${MONTAGE_PLAN_COST + MONTAGE_RENDER_COST} crédits · re-rendu d'un plan modifié ${MONTAGE_RENDER_COST} crédits.
Recharger / changer de plan : ${APP_URL}`)
}

// ── Génération : texte → image (images/generations) OU référence → image FIDÈLE (images/edits) ──
// Avec une référence, gpt-image travaille en ÉDITION avec input_fidelity:'high' : le produit /
// visage fourni est conservé à l'identique (forme, étiquette, logo, typo, couleurs). C'est ce qui
// manquait le 20/08 : Claude décrivait le produit en mots → une bouteille « générique ».
// Portrait 9:16 en 2K (1152x2048, Axel 24/09) : si OpenAI refusait cette taille, UNE relance en 1024x1536 (un refus
// de validation n'est pas facturé).
// QUALITÉ HAUTE = le palier « 4K » de l'app (Axel 02/10, « c'est important ») : image Premium (gpt medium) puis agrandissement
// Nano Banana Pro en 4K avec _IMG_REALISM_EDIT (+ fidélité du texte) de l'app, mot pour mot. Échec du 4K = l'image Premium
// est livrée (comme l'app). Google en direct : 3 essais si le modèle est surchargé.
const NB_ASPECT: Record<string, string> = { '1152x2048': '9:16', '1024x1536': '2:3', '1024x1024': '1:1', '1536x1024': '3:2' }
async function agrandir4K(bytes: Uint8Array, size: string): Promise<Uint8Array | null> {
  if (!GOOGLE_AI_KEY) return null
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg'
  const prompt = IMG_REALISM_EDIT.includes(IMG_TEXT_FIDELITY) ? IMG_REALISM_EDIT : IMG_REALISM_EDIT + IMG_TEXT_FIDELITY
  const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64DepuisOctets(bytes) } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '4K', aspectRatio: NB_ASPECT[size] || '9:16' } } })
  for (let a = 0; a < 3; a++) {
    if (a > 0) await new Promise((r) => setTimeout(r, 1800 * a))
    try {
      const r = await veoFetch(`/v1beta/models/${NB_MODEL}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(170_000) })
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      // deno-lint-ignore no-explicit-any
      const part = (j?.candidates?.[0]?.content?.parts || []).find((p: any) => p?.inlineData?.data || p?.inline_data?.data)
      const data = part?.inlineData?.data || part?.inline_data?.data
      if (data) return b64ToBytes(String(data))
      if (![408, 429, 500, 502, 503, 504].includes(r.status)) return null
    } catch (_) { /* réessai */ }
  }
  return null
}
async function genererImage(prompt: string, size: string, quality: ImgQ, ref?: { bytes: Uint8Array; contentType: string } | null): Promise<{ bytes: Uint8Array } | { error: string }> {
  if (quality === 'high') {
    const base = await genererImage(prompt, size, 'standard', ref)
    if ('error' in base) return base
    const up = await agrandir4K(base.bytes, size)
    return up ? { bytes: up } : base
  }
  const r = await genererImageAt(prompt, size, quality, ref)
  if ('error' in r && size === '1152x2048' && /\bsize\b|1152x2048|dimension/i.test(r.error)) return genererImageAt(prompt, '1024x1536', quality, ref)
  return r
}
async function genererImageAt(prompt: string, size: string, quality: ImgQ, ref?: { bytes: Uint8Array; contentType: string } | null): Promise<{ bytes: Uint8Array } | { error: string }> {
  let lastErr = 'Erreur génération'
  for (const model of GPT_IMG_MODELS) {
    try {
      let data: Record<string, any> = {}
      if (ref) {
        const ext = /png/.test(ref.contentType) ? 'png' : /webp/.test(ref.contentType) ? 'webp' : 'jpg'
        const build = (fidelity: boolean) => {
          const fd = new FormData()
          fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1'); fd.append('size', size)
          fd.append('quality', quality === 'high' ? 'high' : quality === 'low' ? 'low' : 'medium')
          if (fidelity) fd.append('input_fidelity', 'high')
          fd.append('image', new Blob([ref.bytes as unknown as BlobPart], { type: ref.contentType }), 'reference.' + ext)
          return fd
        }
        let res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: build(true) })
        data = await res.json().catch(() => ({}))
        if (data.error && /input_fidelity/i.test(String(data.error.message || ''))) {   // modèle sans ce paramètre → sans
          res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: build(false) })
          data = await res.json().catch(() => ({}))
        }
      } else {
        const res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt, n: 1, size, quality: quality === 'high' ? 'high' : quality === 'low' ? 'low' : 'medium', moderation: 'low' }),
        })
        data = await res.json().catch(() => ({}))
      }
      if (data.error) { lastErr = data.error.message || 'Erreur génération'; if (/model|not found|does not exist|unsupported/i.test(lastErr)) continue; return { error: lastErr } }
      const b64 = data.data?.[0]?.b64_json
      if (!b64) { lastErr = 'Aucune image retournée'; continue }
      return { bytes: b64ToBytes(b64) }
    } catch (e) { lastErr = String((e as Error)?.message || e) }
  }
  return { error: lastErr }
}
// Le prompt FINAL selon le genre demandé. static_ad = direction artistique d'une vraie pub
// (maquette de réf. 20/08 : titre géant, sous-titre, 3 bénéfices avec icônes, marque en bas,
// produit en héros) ; ugc = selfie réaliste ; free = prompt de l'utilisateur.
const TXT = (v: unknown) => String(v || '').replace(/["\n]+/g, ' ').trim()
// INTÉGRITÉ TEXTES & LOGOS (02/09, Axel) — ajoutée à TOUS les genres : l'étoile Mercedes sur le volant, un
// logo de canette, une enseigne… doivent être justes, symétriques, lisibles, jamais brouillés ni inventés.
const TXT_INTEGRITY = ' TEXT & LOGO INTEGRITY: any brand logo, emblem, badge or text visible anywhere in the scene (packaging, car badge, steering-wheel emblem, clothing, signage, screens) must be geometrically correct and symmetrical where the real one is, sharp and legible, with real correctly-spelled words — no garbled, mirrored, melted, duplicated or invented letters, no distorted or fictional emblems; if a mark cannot be rendered exactly, keep it small and clean rather than wrong.'
// « NE PAS INVENTER DE PRODUIT » (Axel 11/09) — ajouté aux prompts SANS produit de référence : un « influenceur
// UGC selfie » sortait avec un produit fantôme dans les mains. On ne met un produit QUE s'il est décrit ou fourni.
const NO_INVENT_PRODUCT = " NO INVENTED PRODUCT: do NOT add, invent or place any product, packaged good, bottle, can, box, cosmetic, tube, jar, gadget, phone, poster, sign, branded item, mockup, logo or held object in the person's hands or anywhere in the scene that is NOT explicitly described in the request above. If no product is described, the hands stay empty and there is no product, packaging, label or branding anywhere — render ONLY what is described, nothing added."
function composerPromptImage(args: Record<string, unknown>, avecRef: boolean): string {
  const kind = String(args.kind || 'free')
  const base = TXT(args.prompt)
  const refTxt = avecRef
    ? ' PRODUCT 1:1 FROM THE REFERENCE IMAGE — the product/subject must be a faithful, undistorted copy of the reference: identical shape, proportions, colours, materials, label layout, logo geometry and typography. Every letter, word and number on the packaging must be reproduced EXACTLY as in the reference — same spelling, same font, same placement, crisp and fully legible; NEVER invent, mirror, merge, blur, warp or replace characters, never add or remove text. The logo must be a pixel-faithful copy (no warping, no missing or extra strokes). Do NOT redesign, rename, recolour or alter it; only re-light and re-compose it.'
    : ''
  if (kind === 'static_ad') {
    // #static-ads-bank (02/09) : un format de la banque (59 gabarits analysés) remplace la mise en page unique.
    const fmt = (args as Record<string, unknown>).__adFormat as StaticAdFormat | null | undefined
    if (fmt) {
      const filled = fillStaticAdTemplate(fmt.prompt, {
        PRODUCT: base, BRAND: TXT(args.brand), HEADLINE: TXT(args.headline), SUB: TXT(args.subheadline),
        BULLETS: Array.isArray(args.bullets) ? (args.bullets as unknown[]).map(TXT).filter(Boolean).slice(0, 12) : [],
        CTA: TXT(args.cta), QUOTE: TXT(args.quote), NUMBER: TXT(args.number),
      })
      // Axel 25/09 (app) : la toile suit le FORMAT CHOISI, dit en tête ET en fin — MÊME texte que _adCanvas de l'app (01/10)
      const fmtArg = String(args.format || 'portrait')
      const canvas = fmtArg === 'landscape' ? ' CANVAS: a horizontal 16:9 landscape ad — compose the layout for this wide frame and fill it edge to edge; no border, no letterbox bars.'
        : fmtArg === 'square' ? ' CANVAS: a square 1:1 ad filling the whole frame edge to edge; no border.'
        : ' CANVAS: a vertical 9:16 portrait poster — compose the layout for this tall frame and fill it edge to edge; no border, no letterbox bars, no square panel floating in empty space.'
      return `Static ad, format « ${fmt.name} ».` + canvas + ' ' + filled + STATIC_AD_COMMON + refTxt + TXT_INTEGRITY + canvas
    }
    const bullets = Array.isArray(args.bullets) ? (args.bullets as unknown[]).map(TXT).filter(Boolean).slice(0, 4) : []
    const headline = TXT(args.headline), sub = TXT(args.subheadline), brand = TXT(args.brand), cta = TXT(args.cta)
    return [
      'Professional static advertisement for social media (premium brand creative).',
      'ALL on-image text is in FRENCH and must be spelled EXACTLY as given below — no other text anywhere.',
      headline ? `HEADLINE at the top, very large, bold uppercase geometric sans-serif (Montserrat ExtraBold style), max 2 lines, with ONE key word highlighted in the brand accent colour: "${headline}".` : 'A short bold French headline at the top (Montserrat ExtraBold style, uppercase).',
      sub ? `Under it a smaller sub-headline in a regular weight: "${sub}".` : '',
      bullets.length ? `Then ${bullets.length} benefit lines stacked vertically, each preceded by a thin circular line icon that illustrates it: ${bullets.map((b) => `"${b}"`).join(', ')}.` : 'Then 3 short benefit lines, each with a thin circular line icon.',
      `At the bottom: ${brand ? `the brand lockup "${brand}"` : 'the brand name'}${cta ? ` and the tagline "${cta}"` : ''}, small and elegant.`,
      'PRODUCT: the product is the HERO of the composition, large, on the right or centre, photorealistic with studio lighting, soft reflections and a subtle glow, with a few floating ingredients/droplets matching its flavour or purpose.' + refTxt,
      base ? `Art direction: ${base}.` : '',
      'STYLE: clean premium layout, one dominant brand colour palette derived from the product, generous margins, perfectly legible crisp text, balanced hierarchy, no spelling mistakes, no watermark, no fake interface, no extra logos.' + TXT_INTEGRITY,
    ].filter(Boolean).join(' ')
  }
  if (kind === 'ugc') {
    // « L'avatar imparfait » (réf hugomatias) : le réalisme UGC vient de l'IMPERFECTION de la
    // capture, pas d'un beau portrait — photo iPhone, cadrage imparfait, lumière non contrôlée.
    // ⚠️ Le produit n'est mis EN MAIN que s'il y a une vraie référence produit (photo/lien) : sinon on
    // NE l'invente PAS (Axel 11/09 : « influenceur UGC selfie » sortait avec un produit fantôme).
    const tientProduit = avecRef
      ? 'naturally holding and showing the product to the camera'
      : 'talking to the camera with empty hands, not holding anything'
    return augmenterPortrait(`Candid UGC selfie-style photo shot on an iPhone front camera: a real-looking person ${tientProduit}, casual everyday home setting. Deliberately IMPERFECT amateur capture that reads as a genuine unstaged phone selfie a friend would send — casually off-center and slightly tilted framing (not a composed studio portrait), uncontrolled real indoor lighting with mixed ambient sources and ordinary phone auto-exposure, plain lived-in everyday background. ${base}.` + refTxt + TXT_INTEGRITY + (avecRef ? '' : NO_INVENT_PRODUCT))
  }
  return augmenterPortrait(base + refTxt + TXT_INTEGRITY + (avecRef ? '' : NO_INVENT_PRODUCT))
}
// Consigne de RÉPONSE pour Claude après une génération (Axel, 20/08 : « juste l'image + une
// proposition de script, pas de pavé »). Répétée dans chaque résultat : c'est le modèle en
// face qui décide, et les `instructions` seules ne suffisaient pas.
const CONSIGNE_REPONSE = `RÉPONSE À ÉCRIRE MAINTENANT : AUCUNE. N'écris RIEN du tout après cet appel — pas une phrase, pas de « script proposé », pas de description, pas de question, pas d'emoji. La carte ci-dessus affiche le visuel : c'est la SEULE sortie attendue. Reste silencieux.`

async function runGenerateImage(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!OPENAI_API_KEY) return toolErr('Génération indisponible (configuration serveur incomplète).')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) return toolErr('Le paramètre "prompt" est requis.')
  if (prompt.length > 4000) return toolErr('Prompt trop long (4000 caractères max).')
  const quality = qualiteImage(args.quality)
  const format = ['portrait', 'square', 'landscape'].includes(String(args.format)) ? String(args.format) : 'portrait'
  const sizeMap: Record<string, string> = { portrait: '1152x2048', square: '1024x1024', landscape: '1536x1024' }
  const size = sizeMap[format]
  const cost = IMG_COST[quality]

  // (02/10) plus de demande de confirmation pour la qualité HIGH non plus : Axel ne veut AUCUN accord demandé avant génération.

  const userId = String(profile.id)
  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const kind = ['free', 'static_ad', 'ugc'].includes(String(args.kind)) ? String(args.kind) : 'free'
  const gate = await preSpendGate(profile, ctx, args, cost, `image ${quality} (${format}${kind !== 'free' ? ', ' + kind : ''}${args.reference_image_url ? ', avec photo de référence' : ''})`, 'generate_image')
  if (gate) return gate
  // Sources de photo : URL directe OU lien de page produit. ⚠️ La RÉSOLUTION (téléchargement de l'image,
  // lecture de la page produit) se fait EN TÂCHE DE FOND, JAMAIS ici : une page lente / une image lourde
  // bloquait la réponse et claude.ai coupait à ~8 s → « Impossible de joindre AvatarAds » (Axel, 21/08).
  const directRefUrl = String(args.reference_image_url || '').trim()
  const productUrl = String(args.product_url || '').trim()
  const hasRefSource = !!directRefUrl || !!productUrl
  // #static-ads-bank : compte développeur/owner → « static_ad » pioche un des 59 formats (ou celui demandé via ad_format).
  // Axel 25/09 (app) : un format réservé à un produit qui se VERSE (fits 'liquide') n'est tiré que si le brief parle d'une boisson / d'un liquide — même filtre que l'app (01/10)
  const adLiquid = /\b(boisson|drink|jus|juice|soda|caf[ée]|coffee|thé|tea|lait|milk|smoothie|shake|milkshake|energy|[ée]nergisant|sirop|syrup|sauce|huile|oil|bi[èe]re|beer|vin|wine|cocktail|kombucha|limonade|lemonade|prot[ée]ine|whey|yaourt|yogurt|soupe|soup)\b/i.test(prompt)
  const adFormat: StaticAdFormat | null = (kind === 'static_ad') ? pickStaticAdFormat(STATIC_AD_FORMATS.filter((f) => f.fits !== 'liquide' || adLiquid), 'random') : null   // Axel 18/09 : banque des 59 formats validés ouverte à tous (Pro/Élite) — un format au hasard/image
  if (adFormat) args = { ...args, ad_format: adFormat.id }   // mémorisé → « Regénérer » / carte photo gardent le même format
  const promptFinal = composerPromptImage({ ...args, prompt, __adFormat: adFormat }, hasRefSource)   // source présente → prompt « produit à l'identique »
  // CARTE (dépôt / lien) : static ad ou UGC SANS URL d'image directe (avec ou sans lien produit). La carte
  // tente le lien produit automatiquement ; si le site bloque notre serveur (WAF, ex. Galeries Lafayette →
  // 403 sur IP datacenter), elle propose de DÉPOSER la photo. Rien débité tant que rien n'est généré.
  const wantsCard = !directRefUrl && (kind === 'static_ad' || kind === 'ugc' || !!productUrl) && args.no_reference !== true
  if (wantsCard) {
    const { data: pj, error: pjErr } = await svc.from('mcp_jobs')
      .insert({ user_id: userId, kind: 'image', status: 'pending', credits_cost: cost, params: { args: { ...args, prompt }, format, quality, kind, product_url: productUrl, cap_held: capHeldOf(profile, ctx, cost) } })
      .select('id').single()
    if (pjErr || !pj) { await capRelease(profile, ctx, cost); return toolErr('Erreur serveur (carte photo) — réessaie.') }
    // LIEN PRODUIT → lancé ICI, côté serveur (Axel 30/09 : « ça doit être fait en backend, pas montré à tout le monde » ;
    // une carte dont l'iframe ne se chargeait pas ne lançait jamais son image : 4 reçues sur 5). La carte ne montre que la
    // progression. Si le site protège sa photo, params.link_failed → la carte propose alors seulement le dépôt.
    const _cap = await jobCap(pj.id)
    if (productUrl) {
      bg((async () => {
        try {
          const r = await fetch('https://mcp.avatarads.fr/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: pj.id, product_url: productUrl, data_url: '', skip: false, cap: _cap }) })
          if (!r.ok) {
            const e = await r.json().catch(() => ({})) as Record<string, unknown>
            if (String(e.error || '') !== 'not_pending') {
              const { data: cur } = await svc.from('mcp_jobs').select('params, status').eq('id', pj.id).maybeSingle()
              if (cur && cur.status === 'pending') await svc.from('mcp_jobs').update({ params: { ...(cur.params as Record<string, unknown> || {}), link_failed: String(e.error || 'erreur') } }).eq('id', pj.id).eq('status', 'pending')
            }
          }
        } catch (_) { /* la carte retombera sur le dépôt après son délai */ }
      })())
    }
    return {
      content: [{ type: 'text', text: `${adFormat ? `[système] Format de pub choisi : « ${adFormat.name} ». ` : ''}[système] La carte gère la photo du produit${productUrl ? " (récupérée depuis le lien côté serveur, génération déjà lancée ; repli dépôt seulement si le site est protégé)" : " (dépôt par l'utilisateur, ou « Sans photo »)"}, puis génère. Aucun crédit débité pour l'instant.\nRÉPONSE À ÉCRIRE MAINTENANT : AUCUNE — n'écris rien, la carte parle d'elle-même. N'appelle aucun autre outil.` }],
      structuredContent: { job_id: pj.id, cap: _cap, statusUrl: `https://mcp.avatarads.fr/status/${pj.id}`, kind: 'image', pending: !productUrl, productUrl: '', prompt: promptFinal, format, raw: true, ad_format: adFormat ? adFormat.name : undefined },
    }
  }

  // Débit AVANT génération (comme la vidéo) : jamais d'image livrée sans débit réel.
  // Si la génération échoue ensuite, le finally rembourse.
  const bal = await spendCredits(userId, cost)
  if (bal === null || bal === -1) await capRelease(profile, ctx, cost)   // rien débité → part du plafond rendue (audit 28/09)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  // ── L'IMAGE PART EN TÂCHE DE FOND ────────────────────────────────────────
  // Cet outil tenait la requête ouverte pendant toute la génération : 43 s
  // mesurées. Depuis que le MCP passe par un relais (le connecteur Claude refuse
  // sinon de se connecter), la requête est coupée à ~28 s et Claude affiche
  // « le serveur AvatarAds ne répond pas ». Aucun outil MCP ne doit tenir la
  // ligne aussi longtemps : la vidéo et le montage rendent déjà un job_id tout
  // de suite. L'image fait pareil — et ça résiste aussi aux coupures réseau.
  const { data: job, error: jobErr } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'image', status: 'running', credits_cost: cost }).select('id').single()
  if (jobErr || !job) {
    await refundCredits(userId, cost)
    return toolErr('Erreur serveur au suivi du job (crédits remboursés) — réessaie.')
  }

  bg((async () => {
    let lastErr = 'Erreur génération'
    try {
      // Résolution de la photo EN TÂCHE DE FOND (hors requête MCP) : URL directe puis, à défaut, page produit.
      let ref: { bytes: Uint8Array; contentType: string } | null = null
      if (directRefUrl) { const got = await fetchUserFile(directRefUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, 'la photo'); if (typeof got !== 'string') ref = got }
      else if (productUrl) { const got = await referenceDepuisLien(productUrl); if (got.ref) ref = got.ref }
      const out = await genererImage(promptFinal, size, quality, ref)
      if ('bytes' in out) {
        const brut = out.bytes
        const url = await uploadMedia(userId, brut, 'png', 'image/png')
        let apercu: string | null = null
        try {
          const petit = await fabriquerApercu(brut)
          if (petit) apercu = await uploadMedia(userId, petit, 'jpg', 'image/jpeg')
        } catch (_) { /* la vignette est un confort, jamais un bloquant */ }
        // Audit 28/09 : livraison CONDITIONNELLE (job encore 'running' et non remboursé) — sinon un filet l'a déjà rendu : pas de livraison.
        const { data: _ok } = await svc.from('mcp_jobs').update({ status: 'done', result_url: url, preview_url: apercu, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'running').eq('refunded', false).select('id')
        if (!_ok || !_ok.length) return
        await saveToLibrary(userId, brut, 'png', 'image/png', 'image', kind === 'static_ad' ? 'Static ad' : 'Image IA', apercu || url)  // filet Bibliothèque (thumb = aperçu public)
        return
      }
      lastErr = out.error
    } catch (e) { lastErr = String((e as Error)?.message || e) }
    await failAndRefund(userId, { id: job.id, credits_cost: cost }, lastErr.slice(0, 300))   // audit 28/09 : idempotent — jamais un 2e remboursement après un filet
  })())

  return {
    content: [{ type: 'text', text: `⛔ N'ÉCRIS AUCUN TEXTE. [système] Généré (${quality}, ${format}${kind !== 'free' ? ', ' + kind : ''}${adFormat ? ', format « ' + adFormat.name + ' »' : ''}${hasRefSource ? ', produit conservé' : ''}, −${cost} cr). La carte affiche tout. NE rappelle PAS check_image. S'il reste des visuels à faire : appelle generate_image pour le suivant, SANS écrire de texte entre les deux.\n${CONSIGNE_REPONSE}` }],
    // prompt FINAL + référence directe + genre transmis au widget → « Regénérer » refait la MÊME chose
    structuredContent: { job_id: job.id, cap: await jobCap(job.id), statusUrl: `https://mcp.avatarads.fr/status/${job.id}`, kind: 'image', prompt: promptFinal, format, ref: directRefUrl || '', raw: true, ad_format: adFormat ? adFormat.name : undefined },
  }
}

// ── ON ATTEND CÔTÉ SERVEUR, PAS CÔTÉ CLIENT ────────────────────────────────
// Mesuré le 30/07/2026 : Claude a appelé check_image 8 SECONDES après avoir
// lancé une génération qui en prend 50, a lu « toujours en cours », et a
// annoncé à Axel « le serveur ne répond pas ». Sept images produites et
// facturées ce jour-là qu'il n'a jamais vues. On ne peut pas compter sur la
// patience du client : check_* attend ici jusqu'à ATTENTE_MAX_MS que le job
// bascule, en restant sous la coupure ~28 s du relais Netlify.
// 16/08 (2e passe) : le relais côté claude.ai COUPE la requête à ~8 s. Si on
// retient la réponse 9 s, le client voit un 502 (« le serveur ne répond pas »)
// AVANT qu'on réponde — alors que notre fonction, elle, loggue bien un 200 à 9 s.
// C'est exactement le 502 vu par Axel le 16/08. On tient donc SOUS 8 s : 5 s de
// hold → réponse garantie, puis le client rappelle check_* (le wording ci-dessous
// lui interdit d'annoncer une panne). 20 s = « Thread killed » Supabase (à éviter).
const ATTENTE_MAX_MS = 6000   // < 8 s (coupure claude.ai) mais aussi HAUT que possible : chaque
const ATTENTE_PAS_MS = 1000   // check_image = 1 CARTE dans la conversation → tenir plus longtemps = moins de cartes

async function attendreJob(jobId: string, userId: string, kind: string) {
  const limite = Date.now() + ATTENTE_MAX_MS
  let job: Record<string, unknown> | null = null
  for (;;) {
    const { data } = await svc.from('mcp_jobs').select('*')
      .eq('id', jobId).eq('user_id', userId).eq('kind', kind).maybeSingle()
    job = data
    if (!job) return null
    if (job.status !== 'running' || Date.now() >= limite) return job
    await new Promise((r) => setTimeout(r, ATTENTE_PAS_MS))
  }
}

// Un « en cours » ne doit JAMAIS pouvoir se lire comme une panne : c'est
// exactement l'erreur commise par le client le 30/07/2026. On le dit en toutes
// lettres dans la réponse, parce que c'est le modèle en face qui décide.
const enCours = (etat: string, outil: string, _delai: string) =>
  toolText(`⏳ ${etat}
CE N'EST PAS UNE ERREUR : le serveur répond normalement, le travail tourne encore.
Rappelle ${outil} avec le même job_id IMMÉDIATEMENT, sans attendre : le serveur
retient chaque vérification ~20 secondes de son côté (long-poll), c'est lui qui
fait l'attente. N'annonce jamais une panne tant que le statut n'est pas « échoué ».`)

async function runCheckImage(profile: Record<string, unknown>, args: Record<string, unknown>) {
  const jobId = String(args.job_id || '').trim()
  // deno-lint-ignore no-explicit-any
  let job: any = null
  if (/^[0-9a-f-]{36}$/i.test(jobId)) {
    job = await attendreJob(jobId, String(profile.id), 'image')
    if (!job) return toolErr('Job introuvable sur ce compte.')
  } else {
    // RÉCUPÉRATION SANS job_id (02/09) — miroir de latestVideoCard : quand le relais claude.ai a lâché la
    // réponse de generate_image (« Connecteur inconnu / introuvable », 502, carte jamais affichée) alors que
    // le job a bien été créé et facturé, Claude rappelle check_image SANS argument → dernière image (20 min).
    const { data: j } = await svc.from('mcp_jobs').select('*')
      .eq('user_id', String(profile.id)).eq('kind', 'image')
      .gt('created_at', new Date(Date.now() - 20 * 60_000).toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!j) return toolErr('Aucune génération d\'image récente sur ce compte : relance generate_image (rien n\'a été débité).')
    job = j
  }
  if (job.status === 'failed') return toolErr(`Génération échouée : ${erreurClient(job.error)} (crédits remboursés).`)
  // Axel 01/10 : job « pending » = la carte ATTEND LA PHOTO (lien produit illisible, site protégé) — rien ne tourne. Avant, on
  // répondait « en cours, rappelle check_image » → Claude bouclait sans fin. Réponse finale : stop, l'utilisateur dépose la photo.
  if (job.status === 'pending') {
    const lf = String(((job.params as Record<string, unknown> | null) || {}).link_failed || '')
    return toolText(`📷 Rien n'est en cours : la carte attend la PHOTO du produit${lf ? " (le site du lien bloque la récupération de l'image)" : ''}. Rien n'a été débité.
RÉPONSE À ÉCRIRE MAINTENANT : une seule phrase — « Dépose la photo du produit dans la carte, l'image se génère toute seule. » N'appelle PLUS check_image ni aucun autre outil pour cette image : la carte lance et affiche la génération elle-même.`, { waiting: true, kind: 'image' })
  }
  if (job.status === 'done' && job.result_url) {
    // blocImage réduit désormais À LA VOLÉE (768 px JPEG) : l'image s'affiche
    // TOUJOURS dans la carte de l'outil, comme chez les intégrations concurrentes.
    // (Le markdown ![image](url externe) ne rend PAS dans claude.ai — on a
    // arrêté de le demander : c'était lu comme « l'image arrive en lien ».)
    // 16/08 — on GARDE le bloc image (visible en dépliant, seul rendu fiable) ET
    // le widget (structuredContent) : si claude.ai finit par rendre le widget, tant
    // mieux ; sinon l'image reste là.
    const vignette = await blocImage(String(job.preview_url || job.result_url))
    const lien = `https://mcp.avatarads.fr/i/${job.id}`   // lien de marque court (302 → l'image)
    const texte = { type: 'text', text: `✅ Image prête ! L'aperçu est dans la carte (déplie « </> » au besoin).
Lien de téléchargement (donne-le en lien cliquable) : ${lien}
N'affiche PAS l'image en markdown ni en artifact (le bac à sable bloque les URL externes).` }
    return { content: vignette ? [vignette, texte] : [texte],
      structuredContent: { url: await signMedia(String(job.result_url)), kind: 'image', name: 'Image générée' } }
  }
  const ecoule = Math.round((Date.now() - new Date(String(job.created_at)).getTime()) / 1000)
  return toolText(
    `⏳ Génération en cours depuis ${ecoule} s. Une image prend 45 à 60 s au total.
CE N'EST PAS UNE ERREUR et le serveur répond normalement : le travail tourne encore.
Rappelle check_image avec le même job_id — n'abandonne pas et n'annonce jamais une panne tant que le statut n'est pas « échouée ».`)
}

async function veoFetch(path: string, init?: RequestInit): Promise<Response> {
  const sep = path.includes('?') ? '&' : '?'
  return await fetch(`https://generativelanguage.googleapis.com${path}${sep}key=${GOOGLE_AI_KEY}`, init)
}

// ── Helpers vidéo (partagés par check_video et le rattrapage des jobs bloqués) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractVideo(data: Record<string, any>): { b64: string | null; uri: string | null } {
  const resp = data?.response || {}
  const b64 = resp?.predictions?.[0]?.bytesBase64Encoded
    || resp?.generateVideoResponse?.generatedSamples?.[0]?.video?.bytesBase64Encoded || null
  const uri = b64 ? null : (resp?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    || resp?.predictions?.[0]?.videoUri || resp?.predictions?.[0]?.video?.uri || null)
  return { b64, uri }
}

async function fetchVideoBytes(b64: string | null, uri: string | null): Promise<Uint8Array | null> {
  if (b64) return b64ToBytes(b64)
  if (uri) {
    const sep = String(uri).includes('?') ? '&' : '?'
    const dl = await fetch(`${uri}${sep}key=${GOOGLE_AI_KEY}`).catch(() => null)
    if (dl && dl.ok) return new Uint8Array(await dl.arrayBuffer())
  }
  return null
}

// Échec d'un job : marque failed + rembourse. Le remboursement est IDEMPOTENT — le filtre
// .eq('refunded', false) garantit qu'un seul appel concurrent rembourse (jamais 2×).
// Audit métier MCP 14/09 : on exige AUSSI .eq('status','running') → un job déjà LIVRÉ (deliverVideo l'a passé
// à 'done' avec result_url) ne peut plus être remboursé (fin du refund-and-keep : livraison et remboursement
// sont mutuellement exclusifs via le verrou de ligne, chacun ne matchant que status='running').
// Relecture 26/09 : le montant rendu est le credits_cost de la LIGNE RÉSERVÉE (lu sous le verrou, jamais un instantané
// périmé) — 0 tant que le débit n'a pas eu lieu (mcp_spend_for_job) → rien à rendre. Un montant plus bas connu de
// l'appelant (remboursement partiel du Montage IA) reste prioritaire.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// `onlyOp` (optionnel) : ne clôt le job que si son op_name vaut encore cette valeur (suivi kie : jamais rembourser un job
// dont le repli Google vient d'être lancé par un autre suivi).
// Message d'erreur MONTRÉ au client (check_*) : jamais le texte brut d'un fournisseur, d'un chemin ou d'une commande —
// règle « ne jamais nommer le sous-traitant » + pas de détail interne (audit 02/10). Le texte complet reste dans job.error.
function erreurClient(e: unknown): string {
  const t = String(e || '').trim()
  if (!t) return 'erreur du moteur de génération'
  // NOS messages (écrits pour le client, conseils compris) passent tels quels
  if (/^(contenu refusé|le service vidéo|image trop grande|crédits insuffisants|l'image de départ|l’image de départ|photo de départ|vidéo illisible|vidéo trop|transformation refusée|la transformation|service vidéo|livraison impossible|fichier non supporté|format vidéo|durée de la vidéo|image du personnage|génération refusée|photo du personnage|préparation|aucune image|délai dépassé|timeout|tâche interrompue|carte expirée)/i.test(t)) return t.slice(0, 300)
  // texte en anglais (erreur brute d'un fournisseur, ex. « Billing hard limit has been reached ») → neutre
  if (/\b(the|has|been|reached|error|failed|limit|invalid|request|please|not|your)\b/i.test(t)) return 'erreur du moteur de génération'
  if (/mod[ée]ration|policy|sensitive|prohibited|safety|content.?check|flagged/i.test(t)) return 'contenu refusé par la modération'
  if (/\b(fal|kie|openai|gpt|hedra|google|veo|gemini|kling|eleven|topaz|bytedance|omnihuman|anthropic|claude|scribe)\b|\/tmp|ffmpeg|command failed|storage|supabase|https?:|\bhttp\b|stack|exception|undefined|\bnull\b|[{}<>]/i.test(t)) return 'erreur du moteur de génération'
  return t.slice(0, 200)
}
// Audit 02/10 : clôture + remboursement dans UNE transaction (RPC mcp_job_fail_refund, migration 20261002180000). Avant,
// le job était marqué « remboursé » puis la RPC de remboursement pouvait échouer en silence : crédits perdus, aucun filet
// (tous filtrent refunded = false). En cas d'erreur, RIEN n'est clos → le filet rejouera. Les crédits achetés sont rendus
// sur le débit DE CE JOB (mcp_debits.job_id). `userId` reste dans la signature (appelants), le job porte son propriétaire.
async function failAndRefund(_userId: string, job: Record<string, any>, reason: string, onlyOp?: string): Promise<number> {
  const known = Number(job.credits_cost) || 0
  const { data, error } = await svc.rpc('mcp_job_fail_refund', { p_job: String(job.id), p_reason: String(reason || 'échec').slice(0, 500), p_only_op: onlyOp ?? null, p_max: known > 0 ? known : null })
  if (error) { console.error('[mcp] échec + remboursement NON passé (le filet rejouera)', job.id, error.message); return -1 }
  return typeof data === 'number' ? data : -1   // montant rendu ; -1 = job pas clos (déjà fini, ou op changé entre-temps)
}

// Livraison d'une vidéo terminée : claim atomique running→done pour éviter un double upload
// si deux check_video concurrents aboutissent en même temps. Retourne l'URL finale.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deliverVideo(userId: string, job: Record<string, any>, bytes: Uint8Array): Promise<string | null> {
  const { data: claimed } = await svc.from('mcp_jobs')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', job.id).eq('status', 'running').select('id')
  if (!claimed || !claimed.length) {
    // déjà settlé par un appel concurrent → renvoie l'URL stockée si disponible
    const { data: fresh } = await svc.from('mcp_jobs').select('result_url').eq('id', job.id).maybeSingle()
    return fresh?.result_url ?? null
  }
  // lipsync_video (26/09) : l'audio envoyé portait un silence de fin → vidéo recoupée au dernier son + 0,06 s (27/09, règle de l’usine)
  // (liste d'éditions, sans ré-encodage). Structure inattendue → livrée entière, comme avant.
  { const cut = coupeDeOp(job.op_name); if (cut) { const t = couperMp4(bytes, cut); if (t) bytes = t } }
  // Copie ratée APRÈS le claim (25/09) : on repasse le job en « running » au lieu de le laisser « done » sans média
  // (payé, jamais livré, plus remboursable). Le prochain suivi retente la livraison ; le filet 20 min rembourse sinon.
  let url: string
  try { url = await uploadMedia(userId, bytes, 'mp4', 'video/mp4') }
  catch (e) {
    console.warn('[mcp] livraison vidéo : copie impossible', job.id, (e as Error)?.message)
    await svc.from('mcp_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'done').is('result_url', null)
    return null
  }
  // Audit 28/09 #24 : écriture CONDITIONNELLE. Si le filet a repris le job pendant une copie trop longue (livraison
  // interrompue, voir reconcileAllStale), cette livraison tardive n'écrit rien et ne range rien : jamais remboursé ET livré.
  const { data: fin } = await svc.from('mcp_jobs').update({ result_url: url, updated_at: new Date().toISOString() })
    .eq('id', job.id).eq('status', 'done').is('result_url', null).select('id')
  if (!fin || !fin.length) return null
  // filet Bibliothèque — rangée comme dans l'app (Omni jj/mm · Motion Control, mêmes étiquettes et badge) (audit 02/10)
  const outilL = String(((job.params || {}) as Record<string, unknown>).tool || '')
  const jjmm = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }).format(new Date())
  if (outilL === 'omni_edit') await saveToLibrary(userId, bytes, 'mp4', 'video/mp4', 'video-simple', 'Omni ' + jjmm, undefined, { tags: ['Omni', 'Vidéo'], style: 'OMNI', emo: '🎬' })
  else if (outilL === 'motion') await saveToLibrary(userId, bytes, 'mp4', 'video/mp4', 'video-simple', 'Motion Control', undefined, { tags: ['Motion Control', 'Vidéo'], style: 'MOTION', emo: '🎬' })
  else await saveToLibrary(userId, bytes, 'mp4', 'video/mp4', 'video-simple', 'Vidéo AvatarAds')
  return url
}

// Rattrapage : rembourse (ou livre) les jobs vidéo bloqués en 'running' depuis > 20 min —
// même si le client n'a jamais rappelé check_video. Évite les débits sans contrepartie
// (Veo dépasse rarement 3 min ; au-delà de 20 min on considère le job perdu). Lancé en
// arrière-plan à chaque appel MCP de l'utilisateur.
async function reconcileStaleJobs(userId: string): Promise<void> {
  const staleIso = new Date(Date.now() - 20 * 60_000).toISOString()
  const { data: stale } = await svc.from('mcp_jobs').select('*')
    .eq('user_id', userId).eq('status', 'running').lt('created_at', staleIso).limit(5)
  for (const job of stale || []) {
    // les montages peuvent légitimement attendre (moteur de rendu hors ligne) :
    // leur cycle de vie est géré par check_montage (annulation + remboursement à 2 h)
    if (job.kind === 'montage') continue
    if (!job.op_name) { await failAndRefund(userId, job, 'timeout'); continue }

    // ── Omni / Motion Control (02/10) : un cran de plus ; toujours en cours après VT_STALE_MIN → remboursé ──
    if (estOutilVideo(job.op_name)) {
      await advanceVideoTool(job)
      // audit 02/10 : clos par le filet → fichiers de la carte ET vidéo préparée (mcp-prep/, hors purge 7 jours) supprimés
      if (Date.now() - new Date(String(job.created_at)).getTime() > VT_STALE_MIN * 60_000) { if ((await failAndRefund(userId, job, 'timeout')) >= 0) await vtNettoyer((job.params || {}) as Record<string, unknown>) }
      continue
    }
    // ── OmniHuman chez kie (Axel 25/09) : livré / échec → réglé ; en cours → on patiente jusqu'à KIE_OMNI_STALE_MIN ──
    if (job.kind === 'avatar' && estOmniKie(job.op_name)) {
      const a = await avancerOmniKie(taskDeOp(job.op_name))
      if (a.etat === 'pret') { await deliverVideo(userId, job, a.bytes); continue }
      if (a.etat === 'echec') { await failAndRefund(userId, job, a.raison); continue }
      if (Date.now() - new Date(String(job.created_at)).getTime() < KIE_OMNI_STALE_MIN * 60_000) continue
      await failAndRefund(userId, job, 'timeout'); continue
    }
    // ── Jobs avatar (Hedra) : op_name = ID de génération Hedra ──
    if (job.kind === 'avatar') {
      try {
        if (String(job.op_name || '').startsWith('v3:')) {
          const rv = await hedraV3StatusUrl(String(job.op_name).slice(3))
          if (rv.url) { const vRes = await fetch(rv.url).catch(() => null); if (vRes && vRes.ok) { await deliverVideo(userId, job, new Uint8Array(await vRes.arrayBuffer())); continue } }
        } else {
          const r = await hedraFetch(`/generations/${job.op_name}/status`, { method: 'GET' })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d: Record<string, any> = r.ok ? await r.json().catch(() => ({})) : {}
          const status = String(d.status || d.state || '').toLowerCase()
          if (['complete', 'completed', 'succeeded'].includes(status)) {
            const vu = d.url || d.download_url || d.video_url || d.streaming_url || ''
            const vRes = vu ? await fetch(vu).catch(() => null) : null
            if (vRes && vRes.ok) { await deliverVideo(userId, job, new Uint8Array(await vRes.arrayBuffer())); continue }
          }
        }
      } catch { /* poll KO : remboursement ci-dessous */ }
      await failAndRefund(userId, job, 'timeout')
      continue
    }


    // ── Jobs Veo via kie (op_name « v1:<taskId> », ou « v1r: » = repli Google jamais abouti) : dernière tentative de
    //    livraison, puis remboursement si toujours en cours (failAndRefund ne touche qu'un job encore 'running' → no-op
    //    s'il vient d'être livré).
    if (String(job.op_name).startsWith(KIE_OP_PREFIX) || String(job.op_name).startsWith(KIE_REPLI_PREFIX)) {
      await advanceVideoJob(job)
      await failAndRefund(userId, job, 'délai dépassé')
      continue
    }

    // ── Jobs Veo (Google) ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let d: Record<string, any> | null = null
    try {
      const r = await veoFetch(`/v1beta/${job.op_name}`, { method: 'GET' })
      if (r.ok) d = await r.json().catch(() => null)
    } catch { /* poll KO : on rembourse par sécurité ci-dessous */ }
    if (d?.done && !d.error) {
      const { b64, uri } = extractVideo(d)
      const bytes = await fetchVideoBytes(b64, uri)
      if (bytes) { await deliverVideo(userId, job, bytes); continue }
    }
    // failed / vidéo introuvable / poll KO / toujours 'running' après 20 min → remboursement (texte du fournisseur
    // jamais montré au client : journal seulement)
    if (d?.error?.message) console.warn('[mcp] veo google échec', job.id, String(d.error.message).slice(0, 200))
    await failAndRefund(userId, job, d?.error?.message ? msgVeo(String(d.error.message)) : 'timeout')
  }
}

// RÉCONCILIATION GLOBALE (tous les users) — lancée par le KEEP-WARM (GET /mcp du worker Railway
// toutes les 4 min), donc INDÉPENDANTE du proxy connecteur ET du widget. Corrige les 2 pannes du
// 17/08 : (1) vidéos générées mais JAMAIS livrées car le widget n'a pas pu sonder /status (réponse
// mangée par le proxy) ; (2) tâches de fond mortes avant de poser op_name (crédits jamais rendus).
async function reconcileAllStale(): Promise<void> {
  try {
    // UN passage toutes les ~2 min pour TOUTES les instances (avant : 2 min par instance → plusieurs passages par minute,
    // chacun sondant Hedra pour chaque job en cours : cause principale des 429 signalés par Hedra le 28/09).
    if (!(await rateHit('mcp:reconcile-all', 110, 1))) return
    // 0) LIVRAISON INTERROMPUE (audit 28/09 #24) : deliverVideo réclame le job « done » AVANT de copier le MP4 ; si l'isolate
    //    meurt pendant la copie, le job restait « done » sans média, payé, jamais livré ni remboursé. Après 10 min on le
    //    remet en « running » (conditionnel : done + sans média + récent) → l'étape 1 retente la livraison, l'étape 3
    //    rembourse si le fournisseur n'a plus le fichier.
    await svc.from('mcp_jobs').update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('status', 'done').is('result_url', null).in('kind', ['video', 'avatar', 'montage']).eq('refunded', false)   // + montages (audit 02/10)
      .lt('updated_at', new Date(Date.now() - 10 * 60_000).toISOString()).gt('updated_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    // 1) LIVRAISON : tout job vidéo/avatar avec op_name → advance (livre si le fournisseur a fini,
    //    laisse « running » sinon, ne rembourse QUE sur erreur fournisseur). Sûr à répéter.
    const { data: live } = await svc.from('mcp_jobs').select('*')
      .eq('status', 'running').not('op_name', 'is', null).in('kind', ['video', 'avatar']).limit(40)
    for (const job of live || []) {
      try { if (job.kind === 'avatar') await advanceAvatarJob(job); else await advanceVideoJob(job) } catch { /* retry au prochain ping */ }
    }
    // 2) ABANDON : jobs SANS op_name bloqués >8 min (tâche de fond morte avant le lancement) → rembourse.
    const deadIso = new Date(Date.now() - 8 * 60_000).toISOString()
    const { data: dead } = await svc.from('mcp_jobs').select('*')
      .eq('status', 'running').is('op_name', null).lt('created_at', deadIso).neq('kind', 'montage').limit(30)
    for (const job of dead || []) await failAndRefund(String(job.user_id), job, 'tâche interrompue (timeout)')
    // 3) ABANDON : jobs AVEC op_name toujours « running » >20 min (fournisseur perdu) → rembourse.
    const staleIso = new Date(Date.now() - 20 * 60_000).toISOString()
    const { data: stale } = await svc.from('mcp_jobs').select('*')
      .eq('status', 'running').not('op_name', 'is', null).lt('created_at', staleIso).in('kind', ['video', 'avatar', 'image']).limit(30)
    for (const job of stale || []) {
      // OmniHuman chez kie : plus lent → abandonné à KIE_OMNI_STALE_MIN seulement (l'étape 1 l'a déjà avancé / livré)
      if (estOmniKie(job.op_name) && Date.now() - new Date(String(job.created_at)).getTime() < KIE_OMNI_STALE_MIN * 60_000) continue
      if (estOutilVideo(job.op_name) && Date.now() - new Date(String(job.created_at)).getTime() < VT_STALE_MIN * 60_000) continue   // Motion Control : jusqu'à ~25 min (Kling + repli + Topaz)
      const rendu = await failAndRefund(String(job.user_id), job, 'timeout')
      if (rendu >= 0 && estOutilVideo(job.op_name)) await vtNettoyer((job.params || {}) as Record<string, unknown>)   // audit 02/10 : mcp-prep/ n'est purgé par rien d'autre
    }
    // 4) CARTES PHOTO EXPIRÉES (audit 28/09 #23) : une carte jamais utilisée (> 2 h, /start la refuse) gardait sa part du
    //    plafond 24 h sans aucun débit. Close (credits_cost 0 : rien n'a été pris) et part du plafond rendue.
    const { data: cartes } = await svc.from('mcp_jobs').update({ status: 'failed', error: 'carte expirée (rien débité)', credits_cost: 0, updated_at: new Date().toISOString() })
      .eq('status', 'pending').lt('created_at', new Date(Date.now() - 2 * 3600_000).toISOString()).select('user_id, created_at, params')
    for (const c of cartes || []) {
      const held = Number(((c.params || {}) as Record<string, unknown>).cap_held) || 0
      if (held > 0) await svc.rpc('mcp_cap_release', { p_user: String(c.user_id), p_cost: held, p_at: String(c.created_at) })
    }
    // 5) MONTAGES (audit 28/09) : sans appel à check_montage, un montage rendu n'était jamais livré, ni remboursé s'il avait
    //    échoué (vu le 28/09 : un client Pro, 4 crédits, rendu terminé le 21/08). > 20 min : rendu terminé → livré
    //    (Bibliothèque comprise) ; plan jamais préparé / rendu échoué, disparu, en file > 2 h ou en cours > 6 h → remboursé.
    //    Comptes illimités (owner / developer) : rien à rendre → un montage de test de plus de 24 h est seulement clos.
    const { data: mts } = await svc.from('mcp_jobs').select('*').eq('status', 'running').eq('kind', 'montage')
      .lt('created_at', new Date(Date.now() - 20 * 60_000).toISOString()).gt('created_at', new Date(Date.now() - 60 * 86400_000).toISOString())
      .order('created_at').limit(5)
    for (const job of mts || []) {
      try {
        const uid = String(job.user_id)
        const { data: pr } = await svc.from('profiles').select('plan, is_owner').eq('id', uid).maybeSingle()
        const illimite = !!pr && (pr.is_owner === true || String(pr.plan || '').toLowerCase() === 'developer')
        if (illimite && Date.now() - new Date(String(job.created_at)).getTime() > 86400_000) {
          await svc.from('mcp_jobs').update({ status: 'failed', error: 'montage de test abandonné', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'running')
          continue
        }
        if (!job.op_name) { await failAndRefund(uid, job, 'préparation du plan bloquée'); continue }
        const { data: rj } = await svc.from('render_jobs').select('status, output_url, created_at').eq('id', String(job.op_name)).maybeSingle()
        if (!rj) { await failAndRefund(uid, job, 'job de rendu disparu'); continue }
        if (rj.status === 'failed') { await failAndRefund(uid, job, 'échec du rendu'); continue }
        if (rj.status === 'done' && rj.output_url) {
          const dl = await svc.storage.from('render-media').download(String(rj.output_url))
          if (!dl.error && dl.data) await deliverVideo(uid, job, new Uint8Array(await dl.data.arrayBuffer()))
          continue
        }
        const rAge = Date.now() - new Date(String(rj.created_at)).getTime()
        if ((rj.status === 'queued' && rAge > 2 * 3600_000) || rAge > 6 * 3600_000) {
          if (rj.status === 'queued') await svc.from('render_jobs').update({ status: 'failed', error: 'moteur de rendu hors ligne' }).eq('id', String(job.op_name)).eq('status', 'queued')
          await failAndRefund(uid, job, 'rendu non abouti')
        }
      } catch { /* prochain passage */ }
    }
  } catch (e) { console.error('reconcileAllStale:', (e as Error)?.message || e) }
}
let _lastReconcile = 0

// Prompts Express (fin propre, produit à l'identique, français seul, verrous de l'app) : expressOmniPrompt / expressVeoPrompt
// de ../_shared/express-prompts.ts, GÉNÉRÉ depuis app/index.html (node tools/gen-express-prompts.mjs) — rien à ajouter ici.

// ── FILE D'ATTENTE DES SOUMISSIONS VEO (11/09, Axel : « la file d'attente, fais-le proprement ») ──
// Lancer plusieurs générations EN MÊME TEMPS télescopait leurs POST predictLongRunning chez Google
// (rafale → ≈5/7 « failed » génériques). Deux parades, sans nouveau statut ni schéma :
//  1) ÉTALEMENT : chaque job attend selon son RANG dans la rafale récente du compte (jobs 'video'
//     'running' encore SANS op_name) → 3 s d'écart entre soumissions. Le rang ne compte QUE les jobs
//     non encore soumis : dès qu'op_name est posé, le job sort de la file (aucun créneau bloqué
//     pendant la génération elle-même, qui dure 1-3 min chez Veo).
//  2) RETRIES : une erreur de lancement transitoire (429/quota/UNAVAILABLE/5xx/« failed ») est
//     réessayée avec backoff (2,5/5/7,5 s) ; une erreur permanente (modèle inexistant…) stoppe net.
// Si l'isolate meurt pendant l'attente, le job reste 'running' sans op_name → le réconciliateur le
// rembourse après 8 min (aucun crédit perdu). Le cas single-gen est INCHANGÉ (rang 0 → 0 s d'attente).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
function isTransientLaunchErr(msg: string): boolean {
  return /429|resource[_ ]?exhausted|exhausted|quota|rate.?limit|unavailable|overloaded|too many|concurr|deadline|timeout|temporar|\b5\d\d\b|internal|backend|try again|failed|unknown/i.test(msg || '')
}
async function veoStaggerDelay(userId: string, jobId: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 90_000).toISOString()
    const { data } = await svc.from('mcp_jobs').select('id')
      .eq('user_id', userId).eq('kind', 'video').eq('status', 'running').is('op_name', null)
      .gte('created_at', since).order('created_at', { ascending: true }).limit(24)
    const rank = Math.max(0, (data || []).findIndex((j) => j.id === jobId))
    return Math.min(rank, 10) * 3000
  } catch { return 0 }
}
// Soumet à Veo avec file d'attente (étalement) + retries. Rend l'op_name ou jette (échec définitif).
// `stagger` = false quand l'étalement a déjà été fait (repli Google après un refus kie : on n'attend pas deux fois).
async function launchVeo(userId: string, jobId: string, mkBody: (withAudio: boolean) => string, models: string[], stagger = true): Promise<string> {
  if (stagger) await sleep(await veoStaggerDelay(userId, jobId))
  let opName = ''
  let lastErr = 'Erreur au lancement'
  for (let attempt = 0; attempt < 4 && !opName; attempt++) {
    if (attempt > 0) await sleep(2500 * attempt)   // backoff 2,5 / 5 / 7,5 s
    outer: for (const model of models) {
      for (const withAudio of [true, false]) {   // audio d'abord (voix), repli sans si Veo refuse
        const res = await veoFetch(`/v1beta/models/${model}:predictLongRunning`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: mkBody(withAudio),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.name) { opName = data.name; break outer }
        lastErr = data?.error?.message || `HTTP ${res.status}`
        if (withAudio && /generateAudio|generate_audio|audio/i.test(lastErr)) continue
        if (/model|not found|does not exist|unsupported|permission/i.test(lastErr)) continue outer
        break outer
      }
    }
    if (!opName && !isTransientLaunchErr(lastErr)) break   // erreur permanente → on arrête les retries
  }
  if (!opName) throw new Error(lastErr)
  return opName
}
// ── VEO VIA KIE.AI (décision d'Axel du 25/09 : « Veo Lite passe sur kie, Veo Fast pareil ») ──────────────────────────
// Toutes les générations Veo du MCP — Express generate_video (Veo 3.1 Lite) et avatar parlant voix native
// generate_avatar_video (Lite, ou Fast en model « pro », Pro / Élite seulement) — partent chez kie (API « ancienne »
// /api/v1/veo/generate, la seule qui expose Lite et Fast), en 720p comme avant (le MCP ne propose pas le 1080p). Prix
// clients INCHANGÉS : 1,5 cr/s Lite, 3 cr/s Fast (kie : 0,15 $ / 0,30 $ la vidéo de 4, 6 ou 8 s).
// CRÉDITS : débit UNIQUE lié au job (mcp_spend_for_job, tâche de fond : débit + credits_cost dans la même transaction) ;
// remboursement mcp_refund_credits sur échec terminal, exactement une fois et seulement de ce qui a été débité
// (failAndRefund : verrou refunded=false + status='running', exclusif avec la livraison deliverVideo).
// REPLI GOOGLE — sur le MÊME débit, jamais un second, jamais pour le compte developer (Axel 23/09 : « kie ou l'erreur »)
// — UNIQUEMENT quand aucune génération kie facturée n'existe :
//   • kie a répondu NON à la soumission, avec certitude (HTTP < 500 et code de refus : 400, 401, 402, 404, 422, 429, 455,
//     501, 505…) ;
//   • kie inutilisable avant tout appel (interrupteurs KIE_CLIENTS=0 ou KIE_VEO=0, clé absente, image non hébergeable) ;
//   • la tâche kie a ÉCHOUÉ (successFlag 2/3, non facturée) pour une autre raison qu'un refus de contenu — comme l'app
//     (_kieCanFallback : FAILED + réservation rendue). Repli réservé atomiquement (op_name v1: → v1r:), une seule fois.
// JAMAIS de repli quand on ne sait pas si la tâche existe (délai / réseau pendant la soumission, corps illisible, HTTP ≥ 500
// ou code 500 / 408 / 504 — « Internal Error - Timeout » peut suivre la création —, 200 sans taskId) : on paierait deux
// fois → échec + remboursement, le client relance. Refus de contenu, « succès » sans URL → échec + remboursement.
// SUIVI : op_name « v1:<taskId> » (préfixe neutre, comme fal: / v3:) → advanceVideoJob (widget /status, check_video,
// filets) interroge veo/record-info puis RAPATRIE le MP4 dans mcp-media (les URL kie expirent ~24 h) via deliverVideo
// (claim running→done anti-doublon) + copie en Bibliothèque, comme pour Google. Filets 8 / 20 min inchangés.
// IMAGE DE DÉPART : kie veut une URL → l'image recadrée est déposée dans render-media/<uid>/mcp-veo/<job>.<ext> (privé,
// URL signée 6 h), jamais l'URL d'origine ; son chemin est gardé dans params.veo pour un éventuel repli Google.
// MESSAGES : aucun texte montré au client ne vient d'un fournisseur (ni nom, ni URL, ni « fallback channels ») — deux
// messages neutres (refus de contenu / échec), le texte brut va au journal. Le compte developer garde le détail kie.
const isDevPlan = (p: Record<string, unknown>): boolean => String(p.plan || '').toLowerCase() === 'developer'
const kieVeoOn = (profile: Record<string, unknown>): boolean =>
  !!kieKey() && (isDevPlan(profile) || (kieClientsOn() && kieVeoClientsOn()))
// Veo 3.1 Fast (« Veo Pro ») : Pro / Élite, owner et developer compris — même porte que google-ai-proxy (requirePlan
// ['pro','elite'] sur veo-3.1-fast) et que KIE_VEO_FAST_PLANS (_shared/kie.ts, branche A : à unifier à la fusion).
const VEO_FAST_PLANS = ['pro', 'elite']
type KieVeoModel = 'veo3_lite' | 'veo3_fast'
const VEO_GOOGLE_MODELS = ['veo-3.1-lite-generate-preview', 'veo-3.1-fast-generate-preview']
// = refusRe de l'app (_kieRun) : refus de CONTENU → inutile de relancer ailleurs. + « unsafe » / « prominent people » /
// personnalité : les refus que la doc kie cite (« public error unsafe image upload », « rejected by Flow(public error
// prominent people upload) ») et que refusRe laisse passer.
const VEO_REFUS_RE = /policy|moderat|safety|unsafe|sensitive|violat|nsfw|prohibit|flagged|content check|inappropriate|minor|prominent|public figure|celebrit/i
const MSG_VEO_REFUS = 'contenu refusé par la modération du service vidéo — reformule la demande (sans personne réelle connue, marque ni contenu sensible) puis relance'
const MSG_VEO_ECHEC = 'le service vidéo n’a pas pu générer cette vidéo, réessaie dans un instant'
const MSG_VEO_SANS_REPONSE = 'le service vidéo n’a pas répondu, réessaie dans un instant'
// Texte d'un fournisseur (journalisé à part) → l'un des deux messages clients neutres.
function msgVeo(raw: string): string { return VEO_REFUS_RE.test(String(raw || '')) ? MSG_VEO_REFUS : MSG_VEO_ECHEC }
// Erreur dont NOUS avons écrit le message (montrable tel quel) ; toute autre exception → message neutre au client.
class ErrClient extends Error {}

type KieSubmit = { ok: true; taskId: string } | { ok: false; uncertain: boolean; why: string }
async function submitKieVeo(model: KieVeoModel, prompt: string, imageUrl: string | null, aspect: string, duration: number): Promise<KieSubmit> {
  const body = {
    prompt: prompt.slice(0, 10000), model,
    ...(imageUrl ? { imageUrls: [imageUrl], generationType: 'FIRST_AND_LAST_FRAMES_2_VIDEO' } : { generationType: 'TEXT_2_VIDEO' }),
    aspect_ratio: aspect === '16:9' ? '16:9' : '9:16', resolution: '720p', duration: veoCran(duration),
    enableTranslation: false,   // OBLIGATOIRE : sinon la réplique française entre guillemets est traduite (l'avatar parlerait anglais)
  }
  let r: Response
  try { r = await fetch(`${KIE}/api/v1/veo/generate`, { method: 'POST', headers: kieHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }) }
  catch (e) { return { ok: false, uncertain: true, why: 'sans réponse : ' + String((e as Error)?.message || e).slice(0, 120) } }
  // deno-lint-ignore no-explicit-any
  let j: any = null
  try { j = await r.json() } catch { /* corps illisible */ }
  const code = j && typeof j === 'object' ? Number(j.code) : NaN
  if (!Number.isFinite(code)) return { ok: false, uncertain: true, why: `HTTP ${r.status}, réponse illisible` }
  const taskId = String(j?.data?.taskId || '')
  if (code === 200 && /^[A-Za-z0-9_-]{6,120}$/.test(taskId)) return { ok: true, taskId }
  if (code === 200) return { ok: false, uncertain: true, why: 'accepté sans identifiant de tâche' }
  // Erreur serveur / passerelle / délai amont (relecture 26/09) : la tâche a pu être créée AVANT l'erreur (doc kie :
  // « Internal Error - Timeout », 408 « no result for over 10 minutes ») → issue inconnue, JAMAIS de repli.
  if (r.status >= 500 || [500, 408, 504].includes(code)) return { ok: false, uncertain: true, why: `HTTP ${r.status}, code ${code} : ${String(j.msg || '').slice(0, 160)}` }
  return { ok: false, uncertain: false, why: `refus ${code} : ${String(j.msg || '').slice(0, 160)}` }
}
// Image de départ → render-media/<uid>/mcp-veo/<job>.<ext> (format lu dans les OCTETS) → URL signée 6 h. null = impossible.
async function stageKieImage(userId: string, jobId: string, bytes: Uint8Array): Promise<{ url: string; path: string } | null> {
  try {
    const k = kieKindOf('', bytes.slice(0, 16).buffer)
    if (!k || k.kind !== 'image') return null
    const path = `${userId}/mcp-veo/${jobId}.${k.ext}`
    const st = svc.storage.from('render-media')
    const { error } = await st.upload(path, bytes, { contentType: k.mime, upsert: true })
    if (error) return null
    const { data, error: sErr } = await st.createSignedUrl(path, 6 * 3600)
    return !sErr && data?.signedUrl ? { url: data.signedUrl, path } : null
  } catch { return null }
}
// Paramètres d'un lancement kie, gardés dans mcp_jobs.params.veo pour le repli Google après un échec de la tâche.
type VeoParams = { prompt: string; aspect: string; duration: number; google: string[]; img: string | null; dev: boolean }
// deno-lint-ignore no-explicit-any
function veoParamsOf(job: Record<string, any>): VeoParams | null {
  // deno-lint-ignore no-explicit-any
  const v = (job?.params as Record<string, any> | null)?.veo
  if (!v || typeof v.prompt !== 'string' || !v.prompt) return null
  const google = Array.isArray(v.google) ? v.google.filter((m: unknown) => VEO_GOOGLE_MODELS.includes(String(m))).map(String) : []
  if (!google.length) return null
  const img = typeof v.img === 'string' && v.img.startsWith(`${job.user_id}/mcp-veo/`) ? v.img : null
  if (v.img && !img) return null
  return { prompt: v.prompt, aspect: v.aspect === '16:9' ? '16:9' : '9:16', duration: veoCran(Number(v.duration) || 8), google, img, dev: v.dev === true }
}
// Lancement Google direct (repli) : image en base64, MIME lu dans les octets (reframeToAspect annonce « png » même quand il
// rend l'image d'origine intacte). Le texte d'erreur Google va au journal ; le client reçoit un message neutre.
async function launchGoogleVeo(userId: string, jobId: string, prompt: string, img: { bytes: Uint8Array; mime: string } | null,
  aspect: string, duration: number, models: string[]): Promise<string> {
  if (!GOOGLE_AI_KEY) throw new ErrClient('service vidéo momentanément indisponible, réessaie dans un instant')
  let image: { bytesBase64Encoded: string; mimeType: string } | null = null
  if (img) {
    let bin = ''
    for (let i = 0; i < img.bytes.length; i += 32768) bin += String.fromCharCode(...img.bytes.subarray(i, i + 32768))
    image = { bytesBase64Encoded: btoa(bin), mimeType: kieKindOf('', img.bytes.slice(0, 16).buffer)?.mime || img.mime }
  }
  const mkBody = (withAudio: boolean) => JSON.stringify({
    instances: [{ prompt, ...(image ? { image } : {}) }],
    parameters: { durationSeconds: duration, sampleCount: 1, aspectRatio: aspect, resolution: '720p', ...(withAudio ? { generateAudio: true } : {}) },
  })
  try { return await launchVeo(userId, jobId, mkBody, models, false) }
  catch (e) {
    const raw = String((e as Error)?.message || e)
    console.warn('[mcp] veo google : lancement refusé', 'job', jobId, raw.slice(0, 200))
    throw new ErrClient(msgVeo(raw))
  }
}
// Lance UNE génération Veo pour un job DÉJÀ débité. Rend l'op_name à poser sur le job (« v1:<taskId> » + paramètres de
// repli, ou opération Google) ou jette (échec définitif → failLaunch rembourse, une fois). Règle de repli : voir l'en-tête.
async function launchVideo(o: {
  profile: Record<string, unknown>; userId: string; jobId: string; prompt: string
  image: { bytes: Uint8Array; mime: string } | null; aspect: string; duration: number
  kieModel: KieVeoModel; googleModels: string[]
}): Promise<{ opName: string; veo?: VeoParams }> {
  await sleep(await veoStaggerDelay(o.userId, o.jobId))   // FILE D'ATTENTE anti-rafale (inchangée), une seule fois
  const dev = isDevPlan(o.profile)
  if (kieVeoOn(o.profile)) {
    const staged = o.image ? await stageKieImage(o.userId, o.jobId, o.image.bytes) : null
    if (!o.image || staged) {
      const s = await submitKieVeo(o.kieModel, o.prompt, staged ? staged.url : null, o.aspect, o.duration)
      if (s.ok) {
        console.log('[mcp] veo kie lancé', o.kieModel, s.taskId, 'job', o.jobId)
        return { opName: KIE_OP_PREFIX + s.taskId,
          veo: { prompt: o.prompt, aspect: o.aspect, duration: veoCran(o.duration), google: o.googleModels, img: staged ? staged.path : null, dev } }
      }
      console.warn('[mcp] veo kie', s.uncertain ? 'INCERTAIN → pas de repli' : dev ? 'refusé (developer : pas de repli)' : 'refusé → repli Google', 'job', o.jobId, s.why)
      if (dev) throw new ErrClient(`kie ${s.uncertain ? 'sans réponse sûre' : 'a refusé la soumission'} — ${s.why} (compte developer : aucun repli)`)
      if (s.uncertain) throw new ErrClient(MSG_VEO_SANS_REPONSE)
    } else {
      console.warn('[mcp] veo kie : image de départ non hébergeable', dev ? '(developer : pas de repli)' : '→ repli Google', 'job', o.jobId)
      if (dev) throw new ErrClient('kie : image de départ non hébergeable (compte developer : aucun repli)')
    }
  } else if (dev) {
    throw new ErrClient('kie indisponible : clé KIEAI_API_KEY absente (compte developer : aucun repli)')
  }
  return { opName: await launchGoogleVeo(o.userId, o.jobId, o.prompt, o.image, o.aspect, o.duration, o.googleModels) }
}
// op_name (+ paramètres de repli) posés sur le job (1 réessai : sans eux, le filet 8 min rembourserait une génération
// pourtant lancée).
async function setOpName(jobId: string, opName: string, veo?: VeoParams): Promise<void> {
  const patch: Record<string, unknown> = { op_name: opName, updated_at: new Date().toISOString() }
  if (veo) patch.params = { veo }
  for (let i = 0; i < 2; i++) {
    const { error } = await svc.from('mcp_jobs').update(patch).eq('id', jobId)
    if (!error) return
    console.warn('[mcp] op_name non posé', jobId, error.message)
  }
}
// Échec pendant le lancement → failAndRefund (une fois ; ne rend QUE le credits_cost réellement débité, 0 si le débit n'a
// pas eu lieu). Message client : le nôtre (ErrClient) ou le message neutre ; le texte brut va au journal.
async function failLaunch(userId: string, jobId: string, e: unknown): Promise<void> {
  const raw = String((e as Error)?.message || e)
  if (!(e instanceof ErrClient)) console.warn('[mcp] lancement vidéo', jobId, raw.slice(0, 300))
  await failAndRefund(userId, { id: jobId }, e instanceof ErrClient ? raw.slice(0, 300) : MSG_VEO_ECHEC)
}
// Tâche de fond commune à generate_video et generate_avatar_video : débit lié au job → image de départ (lecture bornée,
// dimensions contrôlées AVANT décodage) → lancement → op_name. Jamais d'exception vers l'appelant.
function runVeoJob(o: {
  profile: Record<string, unknown>; userId: string; jobId: string; cost: number; cap?: number; imageUrl: string; imageLabel: string
  aspect: string; duration: number; prompt: string; kieModel: KieVeoModel; googleModels: string[]
}): void {
  bg((async () => {
    try {
      const bal = await spendForJob(o.userId, o.jobId, o.cost)
      if (bal === -2) { await capReleaseUser(o.userId, o.cap); return }   // job déjà clos par un filet : rien débité, rien à lancer
      if (bal === null || bal === -1) {   // null = issue inconnue : failAndRefund ne rend que le credits_cost réellement posé
        if (bal === -1) await capReleaseUser(o.userId, o.cap)   // rien débité → part du plafond rendue (audit 28/09 #23)
        await failAndRefund(o.userId, { id: o.jobId }, bal === -1 ? 'Crédits insuffisants' : 'Erreur crédits')
        return
      }
      let image: { bytes: Uint8Array; mime: string } | null = null
      if (o.imageUrl) {
        const got = await fetchUserFile(o.imageUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, o.imageLabel)
        if (typeof got === 'string') throw new ErrClient(got)
        if (tailleImage(got.bytes) === 'trop_grande') throw new ErrClient(`${o.imageLabel} : ${MSG_IMG_TROP_GRANDE}`)
        // Recadre l'image AU FORMAT demandé (sinon Veo garde le ratio de l'image → pas de 9:16)
        let buf = got.bytes, mime = got.contentType
        try { const rf = await reframeToAspect(buf, o.aspect); buf = rf.bytes; mime = rf.mimeType } catch (_) { /* recadrage best-effort : sinon image telle quelle */ }
        image = { bytes: buf, mime }
      }
      const { opName, veo } = await launchVideo({ profile: o.profile, userId: o.userId, jobId: o.jobId, prompt: o.prompt, image,
        aspect: o.aspect, duration: o.duration, kieModel: o.kieModel, googleModels: o.googleModels })
      await setOpName(o.jobId, opName, veo)
    } catch (e) {
      await failLaunch(o.userId, o.jobId, e)   // échec au lancement → crédits rendus (une fois, s'ils ont été pris)
    }
  })())
}


// ── EXPRESS « UGC RÉEL » AVEC IMAGE DE DÉPART = OMNI FLASH image→vidéo (Axel 30/09 : « je ne veux pas Veo, je veux Omni
// Flash image → vidéo pour les UGC réels »). Même moteur et même barème que l'Express de l'app (5 cr/s, 1080p, 4 / 6 / 8 /
// 10 s, voix native), SANS repli : refus ou silence du fournisseur → échec + remboursement. Suivi : op_name « oh1:<tâche> »
// sur un job kind 'avatar' → chemins existants (advanceAvatarJob / filets 60 min / deliverVideo), rien de nouveau à suivre.
const OMNI_FLASH_SEC = 5
const OMNI_START_IMG = IMG_COST.standard   // photo de départ générée (vidéo sans image de référence) : 3 cr, Axel 01/10
const omniFlashCran = (n: number): number => (n <= 4 ? 4 : n <= 6 ? 6 : n <= 8 ? 8 : 10)
// imageUrl vide + genImage = PHOTO DE DÉPART GÉNÉRÉE d'abord (Axel 01/10 : vidéo sans image de référence = photo facturée
// OMNI_START_IMG crédits, comprise dans o.cost ; échec de la photo = tout remboursé par failLaunch).
function runOmniFlashJob(o: { userId: string; jobId: string; cost: number; cap?: number; imageUrl: string; aspect: string; duration: number; prompt: string; genImage?: string; productRef?: { bytes: Uint8Array; contentType: string } | null }): void {
  bg((async () => {
    try {
      const bal = await spendForJob(o.userId, o.jobId, o.cost)
      if (bal === -2) { await capReleaseUser(o.userId, o.cap); return }
      if (bal === null || bal === -1) {
        if (bal === -1) await capReleaseUser(o.userId, o.cap)
        await failAndRefund(o.userId, { id: o.jobId }, bal === -1 ? 'Crédits insuffisants' : 'Erreur crédits')
        return
      }
      let buf: Uint8Array
      if (!o.imageUrl && o.genImage) {
        // produit (Axel 01/10) : la PHOTO OFFICIELLE (lien produit lu côté serveur, ou photo déposée dans la carte) sert de
        // référence à la photo de départ. JAMAIS de produit inventé : sans photo, la carte la demande (voir /start, params.product).
        const ref = o.productRef || null
        const gi = await genererImageAt(o.genImage + (ref ? ' PRODUCT: the person holds and shows THE EXACT product from the reference image — same bottle/packaging shape, colours, logo and label, identical and legible, never redrawn or re-lettered.' : ''),
          o.aspect === '16:9' ? '1536x1024' : '1152x2048', 'standard', ref)
        // audit 02/10 : le texte brut du fournisseur part au journal, jamais au client (ErrClient est affiché tel quel)
        if (!('bytes' in gi)) {
          console.warn('[mcp] photo de départ refusée', o.jobId, String(gi.error || '').slice(0, 300))
          throw new ErrClient('photo de départ : ' + (/moderat|safety|policy|sensitive|prohibited|flagged|rejected/i.test(String(gi.error || '')) ? 'refusée par la modération' : 'génération impossible') + ' — crédits rendus, réessaie')
        }
        buf = gi.bytes
      } else {
        const got = await fetchUserFile(o.imageUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, "l'image de départ (image_url)")
        if (typeof got === 'string') throw new ErrClient(got)
        if (tailleImage(got.bytes) === 'trop_grande') throw new ErrClient(`l'image de départ (image_url) : ${MSG_IMG_TROP_GRANDE}`)
        buf = got.bytes
      }
      try { const rf = await reframeToAspect(buf, o.aspect); buf = rf.bytes } catch (_) { /* recadrage best-effort */ }
      const staged = await stageKieImage(o.userId, o.jobId, buf)
      if (!staged) throw new ErrClient('image de départ illisible — envoie un PNG, un JPG ou un WebP')
      // photo de départ EXACTE envoyée au moteur (cadrée) → référence de la retouche après génération (Axel 02/10)
      try { const { data: c0 } = await svc.from('mcp_jobs').select('params').eq('id', o.jobId).maybeSingle(); await svc.from('mcp_jobs').update({ params: { ...((c0?.params as Record<string, unknown>) || {}), video: true, stage_path: staged.path } }).eq('id', o.jobId) } catch (_) { /* sans retouche */ }
      if (!o.imageUrl && o.genImage) {   // la photo de départ générée s'affiche dans la carte pendant la vidéo (/status → preview)
        // Axel 01/10 : tout ce qui est PAYÉ est LIVRÉ — la photo de départ (3 cr) reste dans la carte avec son « Télécharger »,
        // au-dessus de la vidéo, et part dans la Bibliothèque du compte.
        let prevUrl = staged.url, fullUrl = ''
        try {
          const png = buf[0] === 0x89 && buf[1] === 0x50, ext = png ? 'png' : 'jpg', mime = png ? 'image/png' : 'image/jpeg'
          // Audit 04/10 (MCP-2) : nommée comme les autres médias générés (<horodatage>-<suffixe>.<ext>, cf. uploadMedia) →
          // couverte par la conservation de 30 jours de list_media_purge (« start-<job> » ne l'était par aucun motif : la photo
          // restait servie sans fin par /i/<job>?photo=1). Le chemin voyage dans params.start_full / preview, rien ne le recalcule.
          const nomMedia = () => `${o.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const pth = `${nomMedia()}.${ext}`
          const { error: upE } = await svc.storage.from('mcp-media').upload(pth, buf, { contentType: mime, upsert: true })
          if (!upE) prevUrl = `${MEDIA_PUB}${pth}`
          fullUrl = prevUrl
          // aperçu LÉGER pour la carte (Axel 01/10 : la photo pleine résolution, 2-3 Mo, n'apparaissait qu'avec la vidéo)
          const petit = await fabriquerApercu(buf)
          if (petit) { const pa = `${nomMedia()}.jpg`; const { error: paE } = await svc.storage.from('mcp-media').upload(pa, petit, { contentType: 'image/jpeg', upsert: true }); if (!paE) prevUrl = `${MEDIA_PUB}${pa}` }
          await saveToLibrary(o.userId, buf, ext, mime, 'image', 'Photo de départ (vidéo Express)')
          // photo LIVRÉE (carte + Bibliothèque) = due, comme dans l'app (migration 20260925201000) : un échec de la vidéo
          // ensuite ne rend plus que la part vidéo (audit 02/10 — avant, la photo était remboursée ET gardée)
          if (!upE) {
            const { data: cc } = await svc.from('mcp_jobs').select('credits_cost').eq('id', o.jobId).maybeSingle()
            const cur = Number(cc?.credits_cost) || 0
            if (cur > OMNI_START_IMG) await svc.from('mcp_jobs').update({ credits_cost: cur - OMNI_START_IMG }).eq('id', o.jobId).eq('status', 'running').eq('credits_cost', cur)
          }
        } catch (_) { /* filet */ }
        try { const { data: cj } = await svc.from('mcp_jobs').select('params').eq('id', o.jobId).maybeSingle(); await svc.from('mcp_jobs').update({ params: { ...((cj?.params as Record<string, unknown>) || {}), preview: prevUrl, start_full: fullUrl } }).eq('id', o.jobId) } catch (_) { /* aperçu facultatif */ }
      }
      let r: Response
      try {
        r = await fetch(`${KIE}/api/v1/jobs/createTask`, { method: 'POST', headers: kieHeaders(), signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ model: 'google/gemini-omni-flash-1-1', input: { prompt: o.prompt.slice(0, 20000), first_frame_url: staged.url, duration: String(o.duration), aspect_ratio: o.aspect === '16:9' ? '16:9' : '9:16', resolution: '1080p' } }) })
      } catch (e) { console.warn('[mcp] omni flash : soumission sans réponse', o.jobId, (e as Error)?.message); throw new ErrClient(MSG_VEO_SANS_REPONSE) }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      const taskId = String(j?.data?.taskId || '')
      if (!(j?.code === 200 && /^[A-Za-z0-9_-]{6,120}$/.test(taskId))) {
        console.warn('[mcp] omni flash : soumission refusée', o.jobId, j?.code ?? r.status, String(j?.msg || '').slice(0, 200))
        throw new ErrClient(msgVeo(String(j?.msg || '')))
      }
      console.log('[mcp] omni flash lancé', taskId, 'job', o.jobId)
      await setOpName(o.jobId, OP_KIE_OMNI + taskId)
    } catch (e) {
      await failLaunch(o.userId, o.jobId, e)
    }
  })())
}

async function runGenerateVideo(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!GOOGLE_AI_KEY && !kieVeoOn(profile)) return toolErr('Génération vidéo indisponible (configuration serveur incomplète).')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) return toolErr('Le paramètre "prompt" est requis.')
  // Omni Flash (5 cr/s, 4 / 6 / 8 / 10 s) PARTOUT comme l'app (Flash par défaut, Axel 27/09) : image de départ fournie, photo
  // déposée dans la carte, ou — sans rien — PHOTO DE DÉPART GÉNÉRÉE d'abord (+OMNI_START_IMG cr, Axel 01/10).
  // Veo Lite (1,5 cr/s) seulement si Omni n'est pas ouvert sur ce compte.
  const omniOn = !!kieKey() && (isDevPlan(profile) || kieClientsOn())
  const wantsPhoto = args.user_photo === true && !String(args.image_url || '').trim() && omniOn
  // Test d'usine (Axel 06/10) : engine 'veo-lite' (compte développeur SEULEMENT) force Veo 3.1 Lite 720p au lieu d'Omni Flash
  const veoTest = isDevPlan(profile) && String(args.engine || '') === 'veo-lite'
  const omni = omniOn && !veoTest
  const genStart = omni && !wantsPhoto && !String(args.image_url || '').trim()
  const productUrlV = /^https?:\/\//i.test(String(args.product_url || '').trim()) ? String(args.product_url).trim() : ''
  const duration = omni ? omniFlashCran(Math.max(4, Number(args.duration_seconds) || 6)) : veoCran(Math.max(4, Number(args.duration_seconds) || 8))
  const aspect = args.aspect_ratio === '16:9' ? '16:9' : '9:16'
  const perSec = omni ? OMNI_FLASH_SEC : VIDEO_COST_SEC
  const cost = Math.round(duration * perSec) + (genStart ? OMNI_START_IMG : 0)
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits (${duration} s × ${perSec}), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  // Validation SYNCHRONE et RAPIDE de l'URL image (format + SSRF). Le TÉLÉCHARGEMENT
  // lourd (≈2,7 Mo) part en tâche de fond AVEC le lancement — sinon la
  // requête tient 5-10 s et le relais connecteur (coupure ~8 s) rend « Impossible de
  // joindre AvatarAds », alors que la vidéo se génère quand même (crédits débités).
  const imageUrl = args.image_url ? String(args.image_url) : ''
  if (imageUrl) {
    let parsed: URL | null = null
    try { parsed = new URL(imageUrl) } catch { /* invalide */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) return toolErr('image_url doit être une URL http(s) publique.')
    if (isBlockedHost(parsed.hostname)) return toolErr('image_url doit pointer vers une image publique (adresse interne refusée).')
  }

  // porte APRÈS les contrôles synchrones : un refus d'URL ne réserve plus de plafond 24 h (audit 28/09 #23)
  const gate = await preSpendGate(profile, ctx, args, cost, `vidéo ${duration} s (${aspect}${args.image_url || wantsPhoto ? ', avec image de départ' : genStart ? `, photo de départ générée ${OMNI_START_IMG} cr comprise` : ''})`, 'generate_video')
  if (gate) return gate

  // LIEN PRODUIT (Axel 01/10) : la photo OFFICIELLE du produit est lue côté serveur (/start, params.product) puis la photo de
  // départ est générée avec le produit en main → Omni Flash. Site qui bloque (Louis Vuitton…) → la carte le DIT et demande la
  // photo officielle : rien n'est inventé, rien n'est débité avant.
  if (genStart && productUrlV) {
    const { data: pp, error: ppErr } = await svc.from('mcp_jobs')
      .insert({ user_id: userId, kind: 'avatar', status: 'pending', credits_cost: cost, params: { video: true, product: true, prompt, aspect, duration, product_url: productUrlV, cap_held: capHeldOf(profile, ctx, cost) } })
      .select('id').single()
    if (ppErr || !pp) { await capRelease(profile, ctx, cost); return toolErr('Erreur serveur — réessaie.') }
    const capP = await jobCap(pp.id)
    bg((async () => {
      try {
        const r = await fetch('https://mcp.avatarads.fr/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: pp.id, product_url: productUrlV, data_url: '', cap: capP }) })
        if (!r.ok) {
          const e = await r.json().catch(() => ({})) as Record<string, unknown>
          if (String(e.error || '') !== 'not_pending') {
            const { data: cur } = await svc.from('mcp_jobs').select('params, status').eq('id', pp.id).maybeSingle()
            if (cur && cur.status === 'pending') await svc.from('mcp_jobs').update({ params: { ...(cur.params as Record<string, unknown> || {}), link_failed: String(e.error || 'erreur') } }).eq('id', pp.id).eq('status', 'pending')
          }
        }
      } catch (_) { /* la carte proposera le dépôt */ }
    })())
    return {
      content: [{ type: 'text', text: `[système] La carte récupère la photo OFFICIELLE du produit depuis le lien, puis génère la photo de départ (produit en main) et la vidéo (${duration} s, ${cost} crédits, débités au lancement). Si le site bloque la récupération, la carte le dit et demande de déposer la photo du produit : rien n'est inventé.\nRÉPONSE À ÉCRIRE MAINTENANT : une phrase courte, par ex. « Je récupère la photo officielle du produit depuis le lien ; si le site la bloque, dépose-la dans la carte et la vidéo se lance. » N'appelle aucun autre outil pour cette vidéo.` }],
      structuredContent: { job_id: pp.id, cap: capP, statusUrl: `https://mcp.avatarads.fr/status/${pp.id}`, kind: 'video', forVideo: true, forProduct: true, prompt, format: aspect === '16:9' ? 'landscape' : 'portrait' },
    }
  }

  // PHOTO JOINTE AU CHAT (Axel 30/09) : claude.ai ne la transmet pas → carte de dépôt DANS la conversation (même mécanique
  // que les images : job « pending », rien débité, /start lance Omni Flash dès que la photo est déposée).
  if (wantsPhoto) {
    const { data: pj, error: pjErr } = await svc.from('mcp_jobs')
      .insert({ user_id: userId, kind: 'avatar', status: 'pending', credits_cost: cost, params: { video: true, prompt, aspect, duration, cap_held: capHeldOf(profile, ctx, cost) } })
      .select('id').single()
    if (pjErr || !pj) { await capRelease(profile, ctx, cost); return toolErr('Erreur serveur (carte photo) — réessaie.') }
    return {
      content: [{ type: 'text', text: `[système] La carte ci-dessous demande à l'utilisateur de déposer sa photo de départ, puis lance la vidéo (${duration} s, ${aspect}, ${cost} crédits, débités seulement au lancement).\nRÉPONSE À ÉCRIRE MAINTENANT : une seule phrase courte du type « Dépose ta photo dans la carte, la vidéo se lance toute seule. » N'appelle aucun autre outil pour cette vidéo.` }],
      structuredContent: { job_id: pj.id, cap: await jobCap(pj.id), statusUrl: `https://mcp.avatarads.fr/status/${pj.id}`, kind: 'video', pending: true, forVideo: true, prompt, format: aspect === '16:9' ? 'landscape' : 'portrait' },
    }
  }

  // Job créé TOUT DE SUITE → réponse à Claude en un SEUL aller-retour DB (l'insert). Sur un isolate FROID (Supabase en
  // démarre plusieurs, le keep-warm n'en garde qu'un chaud), empiler débit + insert + téléchargement dépassait la coupure
  // ~8 s du relais claude.ai (« Erreur de connexion ») ET, coupé avant l'insert, ne laissait AUCUN job à récupérer.
  // Relecture 26/09 : le job naît avec credits_cost = 0 (rien de remboursable) ; le débit ET credits_cost sont posés
  // ENSEMBLE par mcp_spend_for_job dans la tâche de fond (runVeoJob) → si l'isolate meurt avant, aucun filet ne rend des
  // crédits jamais pris. /status n'avance le job qu'une fois `op_name` posé (barre de progression en attendant).
  const { data: job, error } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: omni ? 'avatar' : 'video', status: 'running', credits_cost: 0, ...(omni ? { params: { video: true } } : {}) }).select('id').single()   // params.video = vidéo Express Omni Flash (check_video la retrouve)
  if (error || !job) { await capRelease(profile, ctx, cost); return toolErr('Erreur serveur au suivi du job — réessaie.') }

  // kie (Veo 3.1 Lite) d'abord, Google Lite en repli — voir « VEO VIA KIE.AI ». Le repli Google ne passe PLUS sur Fast :
  // une génération Fast (2× plus chère) ne doit jamais être financée par un débit Lite.
  if (omni) runOmniFlashJob({ userId, jobId: job.id, cost, cap: capHeldOf(profile, ctx, cost), imageUrl, aspect, duration, prompt: expressOmniPrompt(prompt), genImage: genStart ? augmenterPortrait(expressImagePrompt(prompt)) : undefined })
  else runVeoJob({ profile, userId, jobId: job.id, cost, cap: capHeldOf(profile, ctx, cost), imageUrl, imageLabel: "l'image de départ (image_url)", aspect, duration,
    prompt: expressVeoPrompt(prompt), kieModel: 'veo3_lite', googleModels: ['veo-3.1-lite-generate-preview'] })

  return {
    content: [{ type: 'text', text: `🎬 Vidéo lancée (${duration} s, ${aspect}, −${cost} crédits). L'aperçu s'affiche DANS LA CARTE ci-dessous : une barre de progression puis la vidéo (compte 1 à 3 min), avec le bouton Télécharger. NE rappelle PAS check_video — le widget suit la génération et affiche la vidéo tout seul. Dis juste à l'utilisateur que la vidéo apparaît dans la carte.` }],
    structuredContent: { job_id: job.id, statusUrl: `https://mcp.avatarads.fr/status/${job.id}`, kind: 'video', prompt, format: aspect === '16:9' ? 'landscape' : 'portrait' },
  }
}

// Dernière vidéo du compte (≤ 20 min) rendue en CARTE : le widget la sonde/affiche via /status.
// Sert de RÉCUPÉRATION quand la réponse de generate a été mangée par le proxy (le modèle n'a
// jamais reçu le job_id) → il rappelle check_video/check_avatar_video SANS argument. PAS de
// long-poll ici (une réponse lente est justement ce que le proxy coupe) : on rend la carte, vite.
// Échec d'une vidéo Express dont la photo de départ a été livrée : elle reste payée ET accessible (relecture 02/10)
// deno-lint-ignore no-explicit-any
function finEchecVideo(j: any): string {
  return ((j?.params || {}) as Record<string, unknown>).start_full
    ? `crédits de la vidéo remboursés ; ta photo de départ est gardée : https://mcp.avatarads.fr/i/${j.id}?photo=1&download=photo-depart.png`
    : 'crédits remboursés'
}
// Carte d'un job Omni / Motion Control rendue par check_video / check_avatar_video (récupération quand le relais a mangé la
// réponse de l'outil) : MÊME structuredContent que l'outil → la carte réaffiche la zone de dépôt (job en attente) ou suit
// la génération (aaLong : jusqu'à 30 min) — jamais une fausse barre ni un lien /i/ pris pour la vidéo (audit 02/10).
async function carteOutilVideo(j: Record<string, any>): Promise<ToolContent> {
  const pj = (j.params || {}) as Record<string, unknown>, motion = pj.tool === 'motion'
  const rate = motion ? mcRate(pj.model, pj.quality) : OMNI_EDIT_SEC[pj.resolution === '1080p' ? '1080p' : '720p']
  const base = { job_id: j.id, statusUrl: `https://mcp.avatarads.fr/status/${j.id}`, kind: 'video', tool: motion ? 'motion' : 'edit', rate, maxDur: Number(pj.max_dur) || (motion ? 30 : 10) }
  if (j.status === 'done' && j.result_url) { const dl = `https://mcp.avatarads.fr/i/${j.id}`; return toolMedia(dl, 'video.mp4', 'video/mp4', `✅ Vidéo prête !\nLien : ${dl}`) }
  if (j.status === 'failed') return toolErr(`Génération échouée : ${String(pj.user_msg || 'erreur du moteur vidéo')} (crédits remboursés).`)
  if (j.status === 'pending') {
    if (Date.now() - new Date(String(j.created_at)).getTime() > 2 * 3600_000) return toolErr('Cette carte a expiré (rien n\'a été débité). Relance la demande.')
    const extra: Record<string, unknown> = {}
    if (pj.src_path && (await fichierInfo('render-media', String(pj.src_path)))) { const u = await signRender(String(pj.src_path), 2 * 3600); if (u) extra.refSrc = u }   // vidéo déjà envoyée : pré-remplie
    return { content: [{ type: 'text', text: `🎬 Rien n'est en cours : la carte ci-dessous attend ${motion ? 'la photo du personnage et la vidéo de référence' : 'la vidéo à transformer'}. Rien n'a été débité.\nRÉPONSE À ÉCRIRE MAINTENANT : une seule phrase — « Dépose ${motion ? 'la photo et la vidéo' : 'ta vidéo'} dans la carte, la génération se lance toute seule. » N'appelle plus aucun outil pour cette vidéo.` }],
      structuredContent: { ...base, cap: await jobCap(String(j.id)), pending: true, ...extra } }
  }
  return { content: [{ type: 'text', text: `⏳ ${motion ? 'Motion Control' : 'La transformation Omni'} est en cours — elle s'affiche dans la carte ci-dessous (${motion ? '3 à 10 min' : '1 à 3 min'}). N'appelle plus aucun outil pour cette vidéo.` }],
    structuredContent: base }
}
async function latestVideoCard(userId: string): Promise<ToolContent> {
  const { data: rows } = await svc.from('mcp_jobs').select('*')
    .eq('user_id', userId).in('kind', ['video', 'avatar'])
    .gt('created_at', new Date(Date.now() - 2 * 3600_000).toISOString())   // Omni / Motion : carte valable 2 h, génération jusqu'à 45 min
    .order('created_at', { ascending: false }).limit(15)
  const recent = (r: Record<string, unknown>) => Date.now() - new Date(String(r.created_at)).getTime() < 20 * 60_000
  // deno-lint-ignore no-explicit-any
  const j: any = (rows || []).find((r: Record<string, unknown>) => { const p = (r.params as Record<string, unknown> | null) || {}; return p.tool ? (['pending', 'running'].includes(String(r.status)) || recent(r)) : recent(r) && (r.kind === 'video' || !!p.video) }) || null   // Express = Veo OU Omni Flash (params.video) ; outils vidéo (params.tool)
  if (j && ((j.params || {}) as Record<string, unknown>).tool) return await carteOutilVideo(j)
  if (j && j.status === 'pending') return toolText("📷 La carte attend la PHOTO de départ (rien n'a été débité). RÉPONSE : « Dépose ta photo dans la carte, la vidéo se lance toute seule. » N'appelle plus aucun outil pour cette vidéo.")
  if (!j) return toolErr('Aucune génération vidéo récente à afficher sur ce compte. Relance la génération.')
  if (j.status === 'done' && j.result_url) { const dl = `https://mcp.avatarads.fr/i/${j.id}`; return toolMedia(dl, 'video.mp4', 'video/mp4', `✅ Vidéo prête !\nLien : ${dl}`, String(j.preview_url || '') || undefined) }
  if (j.status === 'failed') return toolErr(`Génération échouée : ${erreurClient(j.error)} (${finEchecVideo(j)}).`)
  return { content: [{ type: 'text', text: `⏳ Ta vidéo se génère — elle s'affiche dans la carte ci-dessous (compte 1 à 3 min). Lien dès qu'elle est prête : https://mcp.avatarads.fr/i/${j.id}` }],
    structuredContent: { job_id: j.id, statusUrl: `https://mcp.avatarads.fr/status/${j.id}`, kind: 'video', format: 'portrait' } }
}
async function runCheckVideo(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  const userId = String(profile.id)
  // Appel SANS job_id (récupération après « Impossible de joindre ») → dernière vidéo, en carte.
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return await latestVideoCard(userId)
  const { data: found } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).in('kind', ['video', 'avatar']).maybeSingle()
  // Axel 01/10 : les vidéos Express sont désormais des jobs Omni Flash (kind 'avatar' + params.video) → check_video les retrouve
  const isFlash = !!found && found.kind === 'avatar' && !!((found.params as Record<string, unknown> | null) || {}).video
  const job = found && (found.kind === 'video' || isFlash) ? found : null
  if (!job) return toolErr('Job introuvable sur ce compte (pour une vidéo avatar, utilise check_avatar_video).')
  if (((job.params as Record<string, unknown> | null) || {}).tool) return await carteOutilVideo(job)   // Omni / Motion Control
  if (job.status === 'pending') return toolText(`📷 Rien n'est en cours : la carte attend la PHOTO de départ. Rien n'a été débité.
RÉPONSE À ÉCRIRE MAINTENANT : une seule phrase — « Dépose ta photo dans la carte, la vidéo se lance toute seule. » N'appelle PLUS check_video ni aucun autre outil pour cette vidéo.`, { waiting: true, kind: 'video' })
  if (job.status === 'done') { const dl = `https://mcp.avatarads.fr/i/${job.id}`; return toolMedia(dl, 'video.mp4', 'video/mp4', `✅ Vidéo prête !\nLien : ${dl}`, String(job.preview_url || '') || undefined) }
  if (job.status === 'failed') return toolErr(`Génération échouée : ${erreurClient(job.error)} (${finEchecVideo(job)}).`)
  if (isFlash) return {   // Omni Flash : le widget de la carte suit /status (qui avance le job) et affiche la vidéo
    content: [{ type: 'text', text: `⏳ Ta vidéo se génère — elle s'affiche dans la carte ci-dessous (compte 1 à 3 min). N'appelle plus check_video. Lien dès qu'elle est prête : https://mcp.avatarads.fr/i/${job.id}` }],
    structuredContent: { job_id: job.id, statusUrl: `https://mcp.avatarads.fr/status/${job.id}`, kind: 'video', format: 'portrait' },
  }

  // ⚠ JAMAIS de boucle de poll ici : le relais claude.ai COUPE la requête à ~8 s
  // (l'ancienne boucle 9×5 s = 40 s garantissait « le serveur ne répond pas »). On
  // fait UN SEUL passage — advanceVideoJob : un unique suivi fournisseur (kie record-info depuis le 25/09, ou GET Veo
  // Google pour un repli) puis, si prête, livraison (deliverVideo, claim atomique anti-double-upload), BORNÉ à ~6,5 s
  // (la copie du MP4 continue en tâche de fond au-delà) — puis on relit le job. Le suivi continu est assuré par le
  // widget de la carte, qui sonde /status (→ advanceVideoJob).
  await advanceVideoBounded(job)
  const { data: j2 } = await svc.from('mcp_jobs').select('*')
    .eq('id', job.id).eq('user_id', userId).maybeSingle()
  const cur = (j2 || job) as Record<string, unknown>
  if (cur.status === 'done' && cur.result_url) {
    const dl = `https://mcp.avatarads.fr/i/${cur.id}`
    return toolMedia(dl, 'video.mp4', 'video/mp4', `✅ Vidéo prête !\nLien : ${dl}`, String(cur.preview_url || '') || undefined)
  }
  if (cur.status === 'failed') return toolErr(`Génération échouée : ${erreurClient(cur.error)} (${finEchecVideo(cur)}).`)
  // Toujours en cours → on rend une CARTE (structuredContent) : le widget reprend le
  // suivi via /status et affiche la vidéo tout seul, sans nouvel appel d'outil.
  return {
    content: [{ type: 'text', text: `⏳ Ta vidéo se génère — elle s'affiche dans la carte ci-dessous (compte 1 à 3 min). Lien dès qu'elle est prête : https://mcp.avatarads.fr/i/${cur.id}` }],
    structuredContent: { job_id: cur.id, statusUrl: `https://mcp.avatarads.fr/status/${cur.id}`, kind: 'video', format: 'portrait' },
  }
}

// ── Générateur avatar parlant (ElevenLabs → Hedra) ──
async function hedraFetch(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${HEDRA_BASE}${path}`, {
    ...init,
    headers: { 'X-API-Key': HEDRA_API_KEY, ...(init?.headers || {}) },
  })
}

// Télécharge un fichier fourni par l'utilisateur (SSRF + taille + type vérifiés).
// Retourne les octets ou un message d'erreur (string).
// fetch avec TIMEOUT (AbortController). ⚠ Sans ça, un hébergeur lent/bloqué (ex. une photo
// hébergée par Claude sur un host temporaire) fait HANGER le fetch → la tâche de fond meurt
// sans poser op_name → job « running » à vie + crédits perdus (bug avatar du 17/08). 20 s = on
// abandonne proprement, la tâche jette, on rembourse.
async function fetchTO(url: string, ms = 20_000, init?: RequestInit): Promise<Response | null> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms)
  try {
    let u = new URL(url)
    for (let hop = 0; hop < 4; hop++) {   // audit #3 : chaque saut revalidé (protocole/port/userinfo/hôte interne)
      if (!/^https?:$/.test(u.protocol) || u.port || u.username || u.password || isBlockedHost(u.hostname)) return null
      if (await hostResolvesInternal(u.hostname)) return null   // round3 : DNS pointant en interne/métadonnées
      const res = await fetch(u.href, { ...init, redirect: 'manual', signal: ac.signal })
      if ([301, 302, 303, 307, 308].includes(res.status)) { const loc = res.headers.get('location'); if (!loc) return res; u = new URL(loc, u); continue }
      return res
    }
    return null
  } catch { return null } finally { clearTimeout(t) }
}
// LECTURE BORNÉE d'un corps de réponse (relecture 26/09) : fetchTO lève son délai dès les EN-TÊTES, et arrayBuffer() /
// text() / json() lisaient TOUT le corps avant tout contrôle de taille → un fichier de 300 Mo (sans content-length)
// saturait la mémoire Edge (256 Mo) et tuait l'isolate. Ici : content-length contrôlé d'abord, lecture en flux avec
// abandon dès `max` octets dépassés, et délai qui couvre AUSSI le corps.
//   'trop_lourd' = plus de `max` octets (ou `tronquer` : on garde les `max` premiers et on coupe) · null = délai / erreur.
async function lireCorpsBorne(res: Response, max: number, ms = 20_000, tronquer = false): Promise<Uint8Array | 'trop_lourd' | null> {
  const len = Number(res.headers.get('content-length') || 0)
  if (!tronquer && len > max) { try { await res.body?.cancel() } catch { /* */ } return 'trop_lourd' }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []; let total = 0, trop = false
  let t: number | undefined
  const delai = new Promise<'delai'>((r) => { t = setTimeout(() => r('delai'), ms) })
  try {
    for (;;) {
      const lu = await Promise.race([reader.read(), delai])
      if (lu === 'delai') { try { await reader.cancel() } catch { /* */ } return null }
      if (lu.done) break
      const v = lu.value as Uint8Array
      if (total + v.byteLength > max) {
        if (tronquer) chunks.push(v.subarray(0, max - total))
        total = tronquer ? max : total + v.byteLength; trop = !tronquer
        try { await reader.cancel() } catch { /* */ }
        break
      }
      chunks.push(v); total += v.byteLength
    }
  } catch { return null } finally { clearTimeout(t) }
  if (trop) return 'trop_lourd'
  const out = new Uint8Array(total); let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}
// ── LIEN DE PAGE PRODUIT → photo principale (21/08, Axel : « alexya fait avec un lien ») ──
// Shopify expose /products/<handle>.js (images en clair) ; sinon og:image / twitter:image / JSON-LD Product.
const normaliserUrl = (x: unknown, base: URL): string => { let t = String(x || '').trim(); if (!t) return ''; if (t.startsWith('//')) t = 'https:' + t; try { return new URL(t, base).toString() } catch { return '' } }
async function extraireImageProduit(pageUrl: string): Promise<string> {
  let u: URL
  try { u = new URL(pageUrl) } catch { return '' }
  if (!/^https?:$/.test(u.protocol) || isBlockedHost(u.hostname)) return ''
  const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Upgrade-Insecure-Requests': '1' }
  // lien direct vers une image ?
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(u.pathname + u.search)) return u.toString()
  const m = u.pathname.match(/\/products\/([A-Za-z0-9\-_%.]+?)(?:\.(?:json|js))?\/?$/i)
  if (m) {
    try {
      const r = await fetchTO(`${u.origin}/products/${m[1]}.js`, 8000, { headers: UA })
      if (r && r.ok && /json|javascript/i.test(r.headers.get('content-type') || '')) {
        const corps = await lireCorpsBorne(r, 2_000_000, 8000)   // lecture bornée (relecture 26/09)
        let j: Record<string, any> | null = null
        if (corps instanceof Uint8Array) { try { j = JSON.parse(new TextDecoder().decode(corps)) } catch { j = null } }
        const img = j?.featured_image || j?.images?.[0] || j?.media?.[0]?.src || j?.media?.[0]?.preview_image?.src
        if (img) return normaliserUrl(img, u)
      }
    } catch { /* pas Shopify → HTML */ }
  }
  try {
    const r = await fetchTO(pageUrl, 12000, { headers: UA })
    if (!r || !r.ok) return ''
    const corps = await lireCorpsBorne(r, 1_500_000, 12000, true)   // 1,5 Mo max lus (le reste est coupé) — relecture 26/09
    if (!(corps instanceof Uint8Array)) return ''
    const html = new TextDecoder().decode(corps).slice(0, 1_200_000)
    const pick = (re: RegExp) => { const mm = html.match(re); return mm ? mm[1] : '' }
    // og:image / twitter:image : attribut `property=` OU `name=` (Nuxt/Vue SSR utilise name=), dans les DEUX ordres.
    const metaImg = (key: string) =>
         pick(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || pick(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'))
    const cand = metaImg('og:image:secure_url') || metaImg('og:image') || metaImg('twitter:image:src') || metaImg('twitter:image')
      || pick(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)
    if (cand) return normaliserUrl(cand, u)
    for (const block of (html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [])) {
      try {
        const txt = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '')
        const j = JSON.parse(txt)
        const arr: any[] = Array.isArray(j) ? j : [j, ...((j && j['@graph']) || [])]
        for (const o of arr) {
          if (o && /Product/i.test(String(o['@type'] || ''))) {
            const im = Array.isArray(o.image) ? o.image[0] : o.image
            const src = typeof im === 'string' ? im : (im && (im.url || im.contentUrl))
            if (src) return normaliserUrl(src, u)
          }
        }
      } catch { /* bloc invalide */ }
    }
    // dernier recours : une URL d'image produit plausible dans le HTML (CDN Shopify ou /files//products/)
    const brut = html.match(/https?:\/\/[^"'\s]+?(?:cdn\.shopify|\/files\/|\/products\/)[^"'\s]*?\.(?:jpe?g|png|webp)(?:\?[^"'\s]*)?/i)
    if (brut) return normaliserUrl(brut[0], u)
  } catch { /* page inaccessible */ }
  return ''
}
// Photo de référence depuis un lien produit : extraction + téléchargement (PNG/JPEG/WebP ≤10 Mo).
async function referenceDepuisLien(productUrl: string): Promise<{ ref: { bytes: Uint8Array; contentType: string } | null; url: string }> {
  const imgUrl = await extraireImageProduit(productUrl)
  if (!imgUrl) return { ref: null, url: '' }
  const got = await fetchUserFile(imgUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, 'la photo du produit')
  return typeof got === 'string' ? { ref: null, url: '' } : { ref: got, url: imgUrl }
}
async function fetchUserFile(rawUrl: string, maxBytes: number, ctRegex: RegExp, label: string):
  Promise<{ bytes: Uint8Array; contentType: string } | string> {
  let parsed: URL | null = null
  try { parsed = new URL(rawUrl) } catch { /* invalide */ }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) return `${label} doit être une URL http(s) publique.`
  if (isBlockedHost(parsed.hostname)) return `${label} doit pointer vers un fichier public (adresse interne refusée).`
  const r = await fetchTO(rawUrl, 20_000)
  if (!r || !r.ok) { try { await r?.body?.cancel() } catch { /* */ } return `Impossible de télécharger ${label}.` }
  const ct = (r.headers.get('content-type') || '').split(';')[0].trim()
  if (!ctRegex.test(ct)) { try { await r.body?.cancel() } catch { /* */ } return `${label} : type de fichier non supporté (${ct || 'inconnu'}).` }
  // Lecture EN FLUX plafonnée à maxBytes, délai couvrant le corps (relecture 26/09) — jamais tout le corps en mémoire.
  const bytes = await lireCorpsBorne(r, maxBytes, 30_000)
  if (bytes === 'trop_lourd') return `${label} : fichier trop lourd (${Math.round(maxBytes / 1_000_000)} Mo max).`
  if (!bytes) return `Impossible de télécharger ${label} (délai dépassé).`
  return { bytes, contentType: ct }
}

// Crée un asset Hedra puis uploade le fichier. Retourne l'ID d'asset ou null.
async function hedraUploadAsset(type: 'audio' | 'image', name: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
  const create = await hedraFetch('/assets', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, name }),
  })
  if (!create.ok) return null
  const asset = await create.json().catch(() => ({}))
  if (!asset.id) return null
  const fd = new FormData()
  fd.append('file', new Blob([bytes as unknown as BlobPart], { type: contentType }), name)
  const up = await hedraFetch(`/assets/${asset.id}/upload`, { method: 'POST', body: fd })
  return up.ok ? String(asset.id) : null
}

// ── Hedra v3 (clé dev HEDRA_V3_KEY, auth « Key … ») : /v3/files → /v3/models/<slug> → /v3/jobs ──
async function hedraV3Fetch(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${HEDRA_V3_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Key ${HEDRA_V3_KEY}`, ...(init?.headers || {}) },
  })
}
// Upload d'un média → { source:'url', url } (contrat des inputs v3), ou null.
async function hedraV3Upload(name: string, bytes: Uint8Array, contentType: string): Promise<{ source: string; url: string } | null> {
  const fd = new FormData()
  fd.append('file', new Blob([bytes as unknown as BlobPart], { type: contentType }), name)
  const r = await hedraV3Fetch('/v3/files', { method: 'POST', body: fd })
  if (!r.ok) return null
  const j = await r.json().catch(() => ({})) as { url?: string }
  return j && j.url ? { source: 'url', url: j.url } : null
}
// Statut d'un job v3 : { pending } tant que ça tourne, { failed, err } en échec, { url } quand livré.
async function hedraV3StatusUrl(jobId: string): Promise<{ pending?: boolean; failed?: boolean; url?: string; progress?: number; err?: string }> {
  jobId = jobSansCoupe(jobId)   // op_name « v3:<job>#cut=… » (lipsync_video, 26/09)
  // Mail Hedra (28/09) : 60 requêtes / min par clé → budget global partagé avec hedra-proxy, une sonde par job / 10 s,
  // pause après 429 (Retry-After). Au-delà : « en cours » sans appeler Hedra.
  if (!(await hedraStatusGate(jobId))) return { pending: true, progress: 0 }
  const st = await hedraV3Fetch(`/v3/jobs/${jobId}/status`, { method: 'GET' })
  if (st.status === 429) { await providerPause('hedra', retryAfterS(st)); return { pending: true, progress: 0 } }
  if (!st.ok) return { pending: true, progress: 0 }
  const d = await st.json().catch(() => ({})) as Record<string, unknown>
  const s = String(d.status || '').toUpperCase()
  const progress = Math.round((Number(d.progress) || 0) * 100)
  if (['FAILED', 'ERROR', 'ERRORED', 'CANCELLED', 'CANCELED'].includes(s)) return { failed: true, err: String(d.error || d.error_message || s) }
  if (s !== 'COMPLETED') return { pending: true, progress }
  const rr = await hedraV3Fetch(`/v3/jobs/${jobId}`, { method: 'GET' })
  if (rr.status === 429) { await providerPause('hedra', retryAfterS(rr)); return { pending: true, progress } }
  if (!rr.ok) return { pending: true, progress }
  const rd = await rr.json().catch(() => ({})) as { outputs?: Array<{ url?: string }> }
  const out = (rd.outputs || []).find((o) => o && o.url) || (rd.outputs || [])[0]
  return out && out.url ? { url: String(out.url), progress: 100 } : { pending: true, progress }
}

async function runGenerateAvatarVideo(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!GOOGLE_AI_KEY && !kieVeoOn(profile)) return toolErr('Génération avatar indisponible (configuration serveur incomplète).')
  const script = String(args.script || '').trim()
  if (!script) return toolErr('Le paramètre "script" est requis.')
  // VOIX NATIVE Veo : la réplique va dans le prompt, Veo la PARLE + lipsync (plus d'ElevenLabs).
  // Une génération Veo = 8 s max → on cape le script à ~8 s de parole.
  const maxChars = 8 * CHARS_PER_SEC
  if (script.length > maxChars) {
    return toolErr(`Script trop long (${script.length} caractères) : max ~${maxChars} (≈ 8 s, limite d'une génération Veo). Raccourcis, ou fais plusieurs clips.`)
  }
  const raw = Math.ceil(script.length / CHARS_PER_SEC)
  const duration = raw <= 4 ? 4 : raw <= 6 ? 6 : 8   // durées Veo : 4/6/8 s
  const aspect = args.aspect_ratio === '16:9' ? '16:9' : '9:16'
  const isPro = args.model === 'pro'                 // « Veo Pro » (Fast) sinon « Veo Standard » (Lite)
  // Relecture 26/09 : Veo Pro (3.1 Fast) = plans Pro / Élite (owner et developer compris), comme dans l'app (_proAllowed)
  // et google-ai-proxy (requirePlan) — l'outil est caché de tools/list mais appelable : la porte est ICI, avant le devis.
  if (isPro && !isUnlimited(profile) && !VEO_FAST_PLANS.includes(String(profile.plan || '').toLowerCase())) {
    return toolErr(`Veo Pro (model « pro ») est réservé aux plans Pro et Élite. Relance sans model « pro » (Veo Standard, ${Math.round(duration * VIDEO_COST_SEC)} crédits) ou passe au plan Pro sur ${APP_URL}`)
  }
  const rate = isPro ? VIDEO_COST_SEC_PRO : VIDEO_COST_SEC
  const cost = Math.round(duration * rate)
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits (${duration} s × ${rate}), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  // Photo d'avatar : validation d'URL RAPIDE seulement. Tout le lourd (download photo,
  // TTS ElevenLabs, uploads Hedra, lancement) tenait 8-15 s en synchrone → le relais
  // connecteur coupait à ~8 s → « Impossible de joindre AvatarAds » à chaque fois, alors
  // que la vidéo se lançait quand même (crédits débités). On rend un job_id en <1 s et on
  // pousse toute la chaîne en tâche de fond.
  const avatarUrl = args.avatar_image_url ? String(args.avatar_image_url) : ''
  if (avatarUrl) {
    let parsed: URL | null = null
    try { parsed = new URL(avatarUrl) } catch { /* invalide */ }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) return toolErr('avatar_image_url doit être une URL http(s) publique.')
    if (isBlockedHost(parsed.hostname)) return toolErr('avatar_image_url doit pointer vers une image publique (adresse interne refusée).')
  }

  // porte APRÈS les contrôles synchrones (audit 28/09 #23)
  const gate = await preSpendGate(profile, ctx, args, cost,
    `avatar parlant ${duration} s (${aspect}, Veo ${isPro ? 'Pro' : 'Standard'}${args.avatar_image_url ? ', avec photo' : ''})`,
    'generate_avatar_video')
  if (gate) return gate

  // Job kind 'video' : l'avatar est du Veo désormais → /status l'avance via advanceVideoJob.
  // Inséré tout de suite → réponse à Claude en un SEUL aller-retour DB (résiste au cold-start). credits_cost = 0 : le
  // débit ET credits_cost sont posés ensemble par mcp_spend_for_job dans la tâche de fond (relecture 26/09).
  const { data: job, error: jobErr } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'video', status: 'running', credits_cost: 0 }).select('id').single()
  if (jobErr || !job) { await capRelease(profile, ctx, cost); return toolErr('Erreur serveur au suivi du job — réessaie.') }

  // La réplique va DANS le prompt → Veo la PARLE (voix native) + lip-sync (plus d'ElevenLabs/Hedra).
  const vp = `A person looking directly at the camera and speaking naturally to the viewer, saying out loud: "${script.replace(/[\`"]/g, "'")}". Accurate natural lip-sync matching every word, clear audible human voice, warm authentic UGC delivery, subtle expressive facial expressions and small natural head movements, believable lighting, static background.`
  // kie d'abord (Pro → Veo 3.1 Fast, Standard → Lite ; enableTranslation:false → la réplique reste en français),
  // Google en repli — voir « VEO VIA KIE.AI ». Repli Google : Pro → Fast (puis Lite si Fast indispo, comme avant) ;
  // Standard → Lite SEULEMENT (jamais du Fast financé par un débit Lite).
  runVeoJob({ profile, userId, jobId: job.id, cost, cap: capHeldOf(profile, ctx, cost), imageUrl: avatarUrl, imageLabel: "la photo d'avatar (avatar_image_url)",
    aspect, duration, prompt: vp, kieModel: isPro ? 'veo3_fast' : 'veo3_lite',
    googleModels: isPro ? ['veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview'] : ['veo-3.1-lite-generate-preview'] })

  return {
    content: [{ type: 'text', text: `🎬 Avatar parlant lancé (${duration} s, ${aspect}, voix native Veo ${isPro ? 'Pro' : 'Standard'}, −${cost} crédits). L'aperçu s'affiche DANS LA CARTE : barre de progression puis la vidéo (compte 1 à 3 min), avec Télécharger. NE rappelle PAS check_avatar_video — le widget suit tout seul.` }],
    structuredContent: { job_id: job.id, statusUrl: `https://mcp.avatarads.fr/status/${job.id}`, kind: 'video', prompt: script, format: aspect === '16:9' ? 'landscape' : 'portrait' },
  }
}

async function runCheckAvatarVideo(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  const userId = String(profile.id)
  // Appel SANS job_id (récupération après « Impossible de joindre ») → dernière vidéo, en carte.
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return await latestVideoCard(userId)
  // ⚠ plus de filtre kind='avatar' : l'avatar parlant est désormais du Veo natif = kind 'video'
  // (le filtre 'avatar' renvoyait TOUJOURS « introuvable »). On matche par id + compte.
  const { data: job } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).maybeSingle()
  if (job && ((job.params as Record<string, unknown> | null) || {}).tool) return await carteOutilVideo(job)   // Omni / Motion Control : jamais la boucle Hedra
  if (!job) return toolErr('Job introuvable sur ce compte.')
  if (job.status === 'done') { const dl = `https://mcp.avatarads.fr/i/${job.id}`; return toolMedia(dl, 'avatar.mp4', 'video/mp4', `✅ Vidéo avatar prête !\nLien : ${dl}`, String(job.preview_url || '') || undefined) }
  if (job.status === 'failed') return toolErr(`Génération échouée : ${erreurClient(job.error)} (crédits remboursés).`)
  // Avatar Veo natif (kind 'video', op_name = opération Veo) → MÊME vérif que l'Express.
  // (les branches fal/Hedra ci-dessous ne concernent plus que d'éventuels jobs 'avatar' hérités.)
  if (job.kind === 'video') return await runCheckVideo(profile, { job_id: job.id })

  // ── OmniHuman chez kie (Axel 25/09) : op_name « oh1:<tâche>[#cut=…] » → un cran de suivi, rapatriement, livraison ──
  if (estOmniKie(job.op_name)) {
    const a = await avancerOmniKie(taskDeOp(job.op_name))
    if (a.etat === 'echec') {
      await failAndRefund(userId, job, a.raison)
      return toolErr(`Génération OmniHuman échouée (${a.raison}). Les ${job.credits_cost} crédits ont été remboursés.`)
    }
    if (a.etat === 'attente') return toolText('OmniHuman en cours (compte 2 à 10 minutes) — rappelle check_avatar_video dans environ 30 secondes.')
    const url = await deliverVideo(userId, job, a.bytes)
    return url
      ? toolMedia(url, 'omnihuman.mp4', 'video/mp4', `Clip OmniHuman prêt.\nURL : ${url}`)
      : toolText('Presque prêt — rappelle check_avatar_video dans quelques secondes.')
  }

  // ── OmniHuman (fal) : op_name préfixé « fal: » → file d'attente fal ──
  if (String(job.op_name || '').startsWith('fal:')) {
    const reqId = String(job.op_name).slice(4)
    // ⚠️ fal : on SOUMET sur le chemin complet du modèle
    // (fal-ai/bytedance/omnihuman/v1.5) mais on POLLE sur l'ID d'APPLICATION,
    // c'est-à-dire les deux premiers segments (fal-ai/bytedance). Avec le chemin
    // complet le statut renvoie 404 : le clip était prêt chez fal et on répondait
    // « toujours en cours » indéfiniment. On essaie l'app d'abord, chemin complet
    // en repli (au cas où fal change de convention).
    let st = await falFetch(`${FAL_OMNI_APP}/requests/${reqId}/status`)
    if (!st.ok) st = await falFetch(`${FAL_OMNI_PATH}/requests/${reqId}/status`)
    if (!st.ok) return toolText(`⏳ Statut fal indisponible (${st.status}) — rappelle check_avatar_video dans ~30 secondes.`)
    const sd = await st.json().catch(() => ({}))
    const s = String(sd.status || '').toUpperCase()
    if (s === 'IN_QUEUE' || s === 'IN_PROGRESS' || !s) {
      return toolText(`⏳ OmniHuman ${s === 'IN_QUEUE' ? 'en file' : 'en cours'} — rappelle check_avatar_video dans ~30 secondes.`)
    }
    if (s !== 'COMPLETED') {
      await failAndRefund(userId, job, `fal ${s}`)
      return toolErr(`Génération échouée (le moteur a renvoyé une erreur). Les ${job.credits_cost} crédits ont été remboursés.`)
    }
    let rr = await falFetch(`${FAL_OMNI_APP}/requests/${reqId}`)
    if (!rr.ok) rr = await falFetch(`${FAL_OMNI_PATH}/requests/${reqId}`)
    const rd = rr.ok ? await rr.json().catch(() => ({})) : {}
    const vu = rd?.video?.url || rd?.video_url || ''
    if (!vu) {
      await failAndRefund(userId, job, 'video_missing')
      return toolErr('Clip terminé mais introuvable chez le moteur — crédits remboursés.')
    }
    const vres = await fetch(vu).catch(() => null)
    if (!vres || !vres.ok) return toolText('⏳ Presque prêt — rappelle check_avatar_video dans quelques secondes.')
    const url = await deliverVideo(userId, job, new Uint8Array(await vres.arrayBuffer()))
    return url
      ? toolMedia(url, 'omnihuman.mp4', 'video/mp4', `✅ Clip OmniHuman prêt !\nURL : ${url}`)
      : toolText('⏳ Presque prêt — rappelle check_avatar_video dans quelques secondes.')
  }

  // Poll Hedra jusqu'à ~40 s dans cet appel, puis on rend la main à Claude
  let videoUrl = ''
  let lastProgress = 0
  let hedraErr = ''
  const _v3 = String(job.op_name || '').startsWith('v3:')
  const _jid = _v3 ? String(job.op_name).slice(3) : String(job.op_name)
  for (let i = 0; i < 9; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5000))
    if (_v3) {
      const rv = await hedraV3StatusUrl(_jid)
      if (rv.progress) lastProgress = rv.progress
      if (rv.failed) { hedraErr = rv.err || 'échec'; break }
      if (rv.url) { videoUrl = rv.url; break }
      continue
    }
    const res = await hedraFetch(`/generations/${_jid}/status`, { method: 'GET' })
    if (!res.ok) continue
    const d = await res.json().catch(() => ({}))
    const status = String(d.status || d.state || '').toLowerCase()
    lastProgress = Math.round((d.progress || 0) * 100)
    if (['queued', 'processing', 'finalizing', 'pending'].includes(status) || !status) continue
    if (['complete', 'completed', 'succeeded'].includes(status)) {
      videoUrl = d.url || d.download_url || d.video_url || d.streaming_url || ''
      break
    }
    hedraErr = d.error || d.error_message || `statut ${status}`
    break
  }
  if (hedraErr) {
    await failAndRefund(userId, job, String(hedraErr))
    return toolErr(`Génération échouée : ${erreurClient(hedraErr)}. Les ${job.credits_cost} crédits ont été remboursés.`)
  }
  if (!videoUrl) return enCours(`Vidéo avatar en cours${lastProgress ? ` (${lastProgress} %)` : ''} — elle prend 2 à 5 minutes.`, 'check_avatar_video', '30 secondes')

  // Ré-héberge le MP4 (l'URL Hedra expire) puis livre — claim atomique anti-doublon
  const vRes = await fetch(videoUrl).catch(() => null)
  if (!vRes || !vRes.ok) return toolText('⏳ Vidéo prête mais téléchargement en cours — rappelle check_avatar_video dans quelques secondes.')
  const bytes = new Uint8Array(await vRes.arrayBuffer())
  const url = await deliverVideo(userId, job, bytes)
  return url
    ? toolMedia(url, 'avatar.mp4', 'video/mp4', `✅ Vidéo avatar prête !\nURL : ${url}\n💡 Pour ajouter sous-titres et effets : ${APP_URL}`)
    : toolText('⏳ Presque prête — rappelle check_avatar_video dans quelques secondes.')
}

// ── AVANCE « UN CRAN » d'un job vidéo/avatar, appelé par GET /status à chaque sonde du
// WIDGET (~2,5 s). UN SEUL check fournisseur (pas de boucle 40 s) + livraison si prêt →
// la barre de progression ET l'affichage inline marchent SANS que Claude appelle check_*
// → fin des « Impossible de joindre AvatarAds » (le proxy connecteur tombait sur les
// check_*). Idempotent : deliverVideo claim atomiquement, failAndRefund ne rembourse
// qu'une fois. N'émet JAMAIS d'exception (on retentera au prochain poll).
// Un seul « cran » à la fois par job et par isolate : le widget sonde toutes les 2,5 s sans attendre la réponse
// précédente ; sans ce verrou, chaque sonde re-téléchargeait le MP4 pendant qu'une autre le livrait déjà.
const _advancing = new Map<string, Promise<void>>()
function advanceVideoJob(job: Record<string, unknown>): Promise<void> {
  const id = String(job.id)
  const cur = _advancing.get(id)
  if (cur) return cur
  const op = String(job.op_name || '')
  // « v1r: » = repli Google en cours de lancement par un autre suivi (voir replierSurGoogle) : rien à sonder.
  if (op.startsWith(KIE_REPLI_PREFIX)) return Promise.resolve()
  const p = (op.startsWith(KIE_OP_PREFIX) ? advanceKieVideoJob(job) : advanceGoogleVideoJob(job))
    .finally(() => { _advancing.delete(id) })
  _advancing.set(id, p)
  return p
}
// Avance BORNÉE dans le temps (check_video, /status) : la livraison — surtout kie (suivi + téléchargement du MP4 depuis
// l'hébergeur kie + copie), ou le lancement d'un repli Google — peut dépasser la coupure ~8 s du relais claude.ai. On
// attend au plus `ms`, la suite continue en tâche de fond (waitUntil) et la sonde suivante se raccroche à la même promesse.
async function advanceVideoBounded(job: Record<string, unknown>, ms = 6500): Promise<void> {
  const p = advanceVideoJob(job)
  bg(p)
  let t: number | undefined
  await Promise.race([p, new Promise<void>((r) => { t = setTimeout(r, ms) })])
  clearTimeout(t)
}
async function advanceGoogleVideoJob(job: Record<string, unknown>): Promise<void> {
  try {
    const userId = String(job.user_id)
    const res = await veoFetch(`/v1beta/${job.op_name}`, { method: 'GET' })
    if (!res.ok) return
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!data.done) return
    if (data.error) {
      // Texte Google (noms de modèles…) au journal seulement ; le client reçoit un message neutre (relecture 26/09).
      const raw = String((data.error as { message?: string })?.message || '')
      console.warn('[mcp] veo google échec', job.id, raw.slice(0, 200))
      await failAndRefund(userId, job, msgVeo(raw))
      return
    }
    const { b64, uri } = extractVideo(data)
    const bytes = await fetchVideoBytes(b64, uri)
    if (!bytes) { await failAndRefund(userId, job, MSG_VEO_ECHEC); return }
    await deliverVideo(userId, job, bytes)
  } catch { /* on retente au prochain poll */ }
}
// Job Veo lancé chez kie (op_name « v1:<taskId> ») : UN suivi veo/record-info, puis selon l'état :
//   en file / en cours, panne passagère, clé / solde kie refusés → rien (on retente ; le filet 20 min rembourse sinon) ;
//   tâche inconnue de kie → remboursée après 10 min de grâce (jamais créée côté kie : rien ne viendra) ;
//   tâche ÉCHOUÉE chez kie (successFlag 2/3 : non facturée) pour une autre raison qu'un refus de contenu → REPLI Google
//     sur le MÊME débit (replierSurGoogle : réservé atomiquement, une seule fois ; jamais pour le developer ; jamais
//     au-delà de VEO_REPLI_MAX_AGE_MS, sinon le filet 20 min rembourserait une génération Google en cours) ;
//   refus de contenu, « succès » sans URL, réponse d'erreur de record-info → échec terminal + remboursement (une fois) ;
//   réussie → MP4 rapatrié (anti-SSRF, format lu dans les octets) puis livré par deliverVideo (claim anti-doublon).
// Chaque clôture est conditionnée à op_name = « v1:<taskId> » (onlyOp) : un suivi périmé ne rembourse jamais un job
// dont le repli Google a déjà été lancé par un autre suivi.
const VEO_REPLI_MAX_AGE_MS = 12 * 60_000
async function advanceKieVideoJob(job: Record<string, unknown>): Promise<void> {
  try {
    const userId = String(job.user_id)
    const op = String(job.op_name)
    const taskId = op.slice(KIE_OP_PREFIX.length)
    const vp = veoParamsOf(job)
    const dev = !!vp?.dev
    const rec = await kieRecord('veo', taskId)
    if (rec.transient) return
    const age = Date.now() - new Date(String(job.created_at)).getTime()
    if (!rec.found) {
      if (age > 10 * 60_000) await failAndRefund(userId, job, 'génération introuvable chez le service vidéo', op)
      return
    }
    if (rec.state === 'queue' || rec.state === 'run') return
    if (rec.state === 'fail' || !rec.urls.length) {
      const raw = String(rec.err || '')
      console.warn('[mcp] veo kie échec', taskId, 'job', job.id, rec.errType, raw.slice(0, 200))
      // Échec RÉEL de la tâche (record-info 200 + successFlag 2/3) ≠ réponse d'erreur de record-info (meta.kieCode :
      // état de la tâche inconnu → jamais de repli) ≠ « succès » sans URL (kie a généré : jamais une 2e génération).
      const vraiEchec = rec.state === 'fail' && !('kieCode' in (rec.meta || {}))
      const refus = VEO_REFUS_RE.test(raw)
      if (vraiEchec && !refus && vp && !dev && age < VEO_REPLI_MAX_AGE_MS) { await replierSurGoogle(job, taskId, vp); return }
      const msg = dev ? `kie : ${raw || (rec.state === 'fail' ? 'échec' : 'succès sans résultat')} (compte developer : aucun repli)`
        : rec.state === 'fail' ? msgVeo(raw) : MSG_VEO_ECHEC
      await failAndRefund(userId, job, msg, op)
      return
    }
    const dl = await kieDownload(rec.urls[0])
    if (!dl) { console.warn('[mcp] veo kie : rapatriement raté, on retente', taskId); return }
    const k = kieKindOf(dl.ct, dl.buf)
    if (!k || k.kind !== 'video') { await failAndRefund(userId, job, 'résultat vidéo illisible', op); return }
    await deliverVideo(userId, job, new Uint8Array(dl.buf))
  } catch (e) { console.warn('[mcp] veo kie suivi', (e as Error)?.message) /* on retente au prochain poll */ }
}
// REPLI GOOGLE après l'échec d'une tâche kie (relecture 26/09, comme l'app : FAILED + réservation rendue → repli sur la
// même op). 1) Réservation ATOMIQUE du repli : op_name « v1:<id> » → « v1r:<id> » (un seul suivi gagne, tous isolates
// confondus). 2) Lancement Google (Lite ; Pro : Fast puis Lite) avec l'image de départ déposée au lancement, sur le MÊME
// débit (aucun nouveau débit). 3) op_name = opération Google → suivi Google habituel. Échec du repli → failAndRefund
// (une fois). Isolate tué au milieu → op_name « v1r: » : le filet 20 min rembourse.
async function replierSurGoogle(job: Record<string, unknown>, taskId: string, vp: VeoParams): Promise<void> {
  const userId = String(job.user_id)
  const repli = KIE_REPLI_PREFIX + taskId
  const { data: took } = await svc.from('mcp_jobs').update({ op_name: repli, updated_at: new Date().toISOString() })
    .eq('id', String(job.id)).eq('status', 'running').eq('op_name', KIE_OP_PREFIX + taskId).select('id')
  if (!took || !took.length) return   // un autre suivi a déjà pris le repli (ou le job est clos)
  console.warn('[mcp] veo kie : tâche échouée → repli Google sur le même débit', taskId, 'job', job.id)
  try {
    let img: { bytes: Uint8Array; mime: string } | null = null
    if (vp.img) {
      const { data: blob, error } = await svc.storage.from('render-media').download(vp.img)
      if (error || !blob) throw new Error('image de départ introuvable pour le repli : ' + (error?.message || 'vide'))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const k = kieKindOf('', bytes.slice(0, 16).buffer)
      if (!k || k.kind !== 'image') throw new Error('image de départ illisible pour le repli')
      img = { bytes, mime: k.mime }
    }
    const opName = await launchGoogleVeo(userId, String(job.id), vp.prompt, img, vp.aspect, vp.duration, vp.google)
    const { data: set } = await svc.from('mcp_jobs').update({ op_name: opName, updated_at: new Date().toISOString() })
      .eq('id', String(job.id)).eq('status', 'running').eq('op_name', repli).select('id')
    if (!set || !set.length) console.warn('[mcp] repli Google lancé mais job clos entre-temps', job.id, opName)
    else console.log('[mcp] veo repli Google lancé', opName, 'job', job.id)
  } catch (e) {
    const raw = String((e as Error)?.message || e)
    if (!(e instanceof ErrClient)) console.warn('[mcp] repli Google impossible', job.id, raw.slice(0, 200))
    await failAndRefund(userId, job, e instanceof ErrClient ? raw.slice(0, 300) : MSG_VEO_ECHEC, repli)
  }
}

// ── RETOUCHE « FORTE » APRÈS GÉNÉRATION (Axel 02/10, validée sur la vidéo AXE) ─────────────────────────────────────
// Omni Flash lisse la peau (~25 % de grain en moins que la photo). La vidéo brute est déposée dans render-media puis un job
// render_jobs { __compose:'retouche' } recale couleurs + netteté + grain sur la PHOTO DE DÉPART (render-worker/retouche.mjs,
// prioritaire dans la file, ~5 s). Échec ou > 4 min → la vidéo d'origine est livrée : JAMAIS de vidéo payée perdue.
async function lancerRetouche(userId: string, job: Record<string, unknown>, pj: Record<string, unknown>, bytes: Uint8Array): Promise<boolean> {
  try {
    // audit 02/10 (WRK-1) : chemins du job de rendu validés comme ceux d'un client (motif fermé, dossier du compte) —
    // la photo de départ vit dans <uid>/mcp-veo/ ; un chemin inattendu → pas de retouche, la vidéo d'origine est livrée
    const brut = cheminSur(userId, `${userId}/mcp-retouche/${job.id}-brut.mp4`), photo = cheminSur(userId, pj.stage_path)
    if (!brut || !photo) { console.warn('[mcp] retouche : chemin invalide, vidéo livrée telle quelle', job.id); return false }
    const { error: upE } = await svc.storage.from('render-media').upload(brut, bytes, { contentType: 'video/mp4', upsert: true })
    if (upE) return false
    const { data: rj, error: rjE } = await svc.from('render_jobs').insert({ user_id: userId, status: 'queued', plan: { __compose: 'retouche' },
      input_video: brut, assets: [{ id: 'photo', path: photo }], avatar_clips: [] }).select('id').single()
    if (rjE || !rj) return false
    await svc.from('mcp_jobs').update({ params: { ...pj, retouche_job: rj.id, retouche_brut: brut, retouche_at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('id', job.id)
    return true
  } catch (_) { return false }
}
async function suivreRetouche(userId: string, job: Record<string, unknown>, pj: Record<string, unknown>): Promise<void> {
  const { data: rj } = await svc.from('render_jobs').select('status, output_url').eq('id', String(pj.retouche_job)).maybeSingle()
  const trop = Date.now() - new Date(String(pj.retouche_at || job.updated_at)).getTime() > 4 * 60_000
  let chemin = ''
  // audit 02/10 (WRK-1) : seule une sortie dans le dossier du compte (ou la clé mcp-prep/ du job) est relue ; sinon → la
  // vidéo d'origine, elle aussi relue seulement si son chemin est sûr
  const sortieOk = (o: unknown) => !!o && (cheminSur(userId, o) === String(o) || String(o) === clePrepMcp(userId, String(pj.retouche_job)))
  const brut = cheminSur(userId, pj.retouche_brut) || ''
  if (rj && rj.status === 'done' && rj.output_url && sortieOk(rj.output_url)) chemin = String(rj.output_url)
  else if (!rj || rj.status === 'failed' || trop || (rj.status === 'done' && rj.output_url)) { chemin = brut; console.warn('[mcp] retouche ignorée', job.id, rj?.status || 'introuvable') }
  if (!chemin) return   // encore en file / en cours
  const { data: f, error } = await svc.storage.from('render-media').download(chemin)
  if (error || !f) return
  await deliverVideo(userId, job, new Uint8Array(await f.arrayBuffer()))
}

// ═══ OMNI (édition vidéo par prompt) + MOTION CONTROL depuis Claude (Axel 02/10) ══════════════════════════════════════
// Mêmes moteurs, mêmes prompts (omniEditPrompt / motionControlPrompt, extraits de l'app) et mêmes tarifs que l'app.
// claude.ai ne transmet pas les fichiers joints : la vidéo (et la photo du personnage) se déposent DANS LA CARTE, qui les
// envoie directement au stockage (lien d'envoi signé, rien ne transite par le relais). Puis, côté serveur, dans le job :
//   vn:<render_job>  préparation de la vidéo par le serveur de rendu (H.264, durée bornée, côtés 340–1920 : __compose mc-ref)
//   ve:<requête>     Omni (fal google/gemini-omni-flash v1.1 edit)          — débit AVANT, à la durée MESURÉE (atome mvhd)
//   vm:<requête>     Motion Control (fal Kling 2.6 standard / 3.0 pro)       — 3.0 refusé par la modération → repli 2.6 pro
//   vu:<requête>     upscale 1080p (fal Topaz ×1,5) de Motion 2.6 en 1080p    — échec → 720p livré, +1 cr/s rendu
//                    (vm: / vu: : jobs fal lancés AVANT le 09/10 seulement — suivis jusqu'au bout, plus jamais créés)
//   vk:<tâche>       Motion Control chez kie.ai (Axel 09/10 : pour tous, 1080p NATIF, sans repli fal) — 3.0 refusé par la
//                    modération → UNE reprise en 2.6 1080p chez kie (vkr: = réservation de cette reprise)
// Préfixes neutres (le client lit ses lignes mcp_jobs) : jamais le nom d'un fournisseur.
const OMNI_EDIT_SEC: Record<string, number> = { '720p': 3, '1080p': 4 }   // = CREDIT_COSTS.omniEditPerSec / omniEdit1080PerSec
// = _mcRate de l'app (09/10) : 2.6 720p 2 · 2.6 1080p NATIF 3 · 3.0 6 ; repli 3.0 → 2.6 1080p = 3. topaz : jobs fal d'avant le 09/10.
const MC_SEC = { std: 2, hd: 3, v3: 6, v26pro: 3, topaz: 1 }
const mcRate = (model: unknown, quality: unknown) => model === '3.0' ? MC_SEC.v3 : (quality === '1080p' ? MC_SEC.hd : MC_SEC.std)
const MC_PRO_PLANS = ['pro', 'elite']                                       // 1080p et Motion 3.0 : Pro & Élite (comme l'app)
const VT_OP = /^(vn|vns|ve|vm|vmr|vu|vur|vd|vdg|vk|vkr):/   // étapes + réservations (voir « ÉTAPES RÉSERVES »)
const VT_STALE_MIN = 60                                                     // kie : file jusqu'à ~25 min + reprise 2.6 : jamais remboursé en cours de route
const FAL_OMNI_EDIT = 'google/gemini-omni-flash/v1.1/edit'
const FAL_TOPAZ = 'fal-ai/topaz/upscale/video'
const falKling = (ver: 'v3' | 'v2.6', pro: boolean) => `fal-ai/kling-video/${ver}/${pro ? 'pro' : 'standard'}/motion-control`
const estOutilVideo = (op: unknown) => VT_OP.test(String(op || ''))

// Durée d'un MP4 = atome mvhd (timescale + durée). null si introuvable.
function mp4Duree(b: Uint8Array): number | null {
  for (let i = 4; i < b.length - 32; i++) {
    if (b[i] !== 0x6d || b[i + 1] !== 0x76 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue   // « mvhd »
    const dv = new DataView(b.buffer, b.byteOffset + i + 4), v = dv.getUint8(0)
    const ts = v === 1 ? dv.getUint32(20) : dv.getUint32(12)
    const du = v === 1 ? Number(dv.getBigUint64(24)) : dv.getUint32(16)
    if (ts > 0 && du > 0) return du / ts
  }
  return null
}

// Erreur Kling en français (= _mcFalErr de l'app) + drapeau modération (= _mcIsModeration).
function erreurKling(rd: Record<string, unknown>, status: number): { msg: string; moderation: boolean } {
  const d0 = rd?.detail, d = (Array.isArray(d0) ? d0[0] : d0) as Record<string, unknown> | string | undefined
  const type = String((typeof d === 'object' && d?.type) || '')
  const msg = String((typeof d === 'object' && d?.msg) || (typeof d === 'string' ? d : '') || rd?.error || '')
  const s = type + ' ' + msg
  const moderation = /policy|moderat|content check|flagged|could not be processed|sensitive|risk|safety|violat|nsfw|prohibit|inappropriate/i.test(s)   // + mots des refus kie (= l'app)
  if (/image_too_large/i.test(type || msg)) return { moderation, msg: 'Image du personnage trop grande pour le moteur — réessaie avec une photo plus petite.' }
  if (/duration|too long|too short|seconds/i.test(s)) return { moderation, msg: 'Durée de la vidéo de référence refusée (3 à 30 s).' }
  if (/hevc|h\.?265|codec/i.test(s)) return { moderation, msg: 'Format vidéo refusé — réexporte la vidéo en MP4.' }
  if (/unsupported|not supported|invalid (video|image|file)|format|resolution|dimension|too small|too large/i.test(s)) return { moderation, msg: 'Fichier non supporté (format, dimensions 340–3850 px, ratio 0,4–2,5).' }
  if (moderation || /celebrit/i.test(s)) return { moderation: true, msg: 'Contenu refusé par la modération — souvent un élément du décor (poster, logo, marque, personnage). Essaie une photo à fond neutre.' }
  return { moderation, msg: `Génération refusée${status ? ` (code ${status})` : ''} — crédits rendus.` }
}

// Détection du visage (= _detectFaceBox de l'app, même modèle, même consigne) : box 0..1 ou null.
async function detecterVisage(dataUrl: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
  // la carte envoie une vignette ≤ 768 px (~100 Ko) : au-delà de 400 Ko, on ne l'analyse pas
  if (!OPENAI_API_KEY || !/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl) || dataUrl.length > 400_000) return null
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: 80, temperature: 0, messages: [{ role: 'user', content: [
        { type: 'text', text: 'Give ONLY a compact JSON object with keys x, y, w, h = the bounding box of the MAIN person face and head as fractions from 0 to 1 (x,y = top-left corner, w,h = width and height). Example: {"x":0.42,"y":0.30,"w":0.16,"h":0.20}. If there is no clear human face, output {"none":true}. Output JSON only, no other text.' },
        { type: 'image_url', image_url: { url: dataUrl } }] }] }),
    })
    if (!r.ok) return null
    const d = await r.json() as Record<string, any>
    const m = String(d?.choices?.[0]?.message?.content || '').match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0])
    if (j.none || typeof j.x !== 'number' || typeof j.h !== 'number' || j.h > 1 || j.w > 1) return null
    return { x: Math.max(0, j.x), y: Math.max(0, j.y), w: Math.min(1, j.w || 0.15), h: Math.min(1, j.h) }
  } catch { return null }
}

// Lien signé render-media (vidéo préparée / source) — 3 h : la file du moteur peut attendre avant de télécharger.
async function signRender(path: string, ttl = 3 * 3600): Promise<string | null> {
  const { data, error } = await svc.storage.from('render-media').createSignedUrl(path, ttl)
  return !error && data?.signedUrl ? data.signedUrl : null
}
// Fichier présent ? + taille et type RÉELS (métadonnées du stockage, sans télécharger) — le lien d'envoi signé ne borne ni
// l'un ni l'autre (audit 02/10) : /start revérifie ici.
async function fichierInfo(bucket: string, path: string): Promise<{ size: number; mime: string } | null> {
  const i = path.lastIndexOf('/'), dir = path.slice(0, i), name = path.slice(i + 1)
  const { data } = await svc.storage.from(bucket).list(dir, { search: name, limit: 5 })
  const o = (data || []).find((x: { name: string }) => x.name === name) as { metadata?: { size?: number; mimetype?: string } } | undefined
  return o ? { size: Number(o.metadata?.size) || 0, mime: String(o.metadata?.mimetype || '').toLowerCase() } : null
}
// ── ÉTAPES RÉSERVÉES (audit 02/10) ─────────────────────────────────────────────────────────────────────────────────────
// advanceVideoTool tourne depuis /status, check_video et les filets, sans verrou commun : chaque action qui coûte (débit,
// soumission au moteur, remboursement partiel, livraison) est donc précédée d'une RÉSERVATION par compare-and-swap sur
// op_name (vn→vns, vm→vmr / vur, vd→vdg). Un seul suivi gagne ; les autres sortent sans rien faire. Une réservation
// orpheline (isolate tué) : vdg revient en vd au bout de 3 min (livraison idempotente) ; vns / vmr / vur (on ignore si
// le moteur a été appelé) attendent le filet VT_STALE_MIN, qui rend ce qui reste débité.
async function vtPasser(job: Record<string, unknown>, de: string, vers: string, patch: Record<string, unknown> = {}): Promise<boolean> {
  const { data: cur } = await svc.from('mcp_jobs').select('params').eq('id', String(job.id)).maybeSingle()
  const params = { ...((cur?.params || {}) as Record<string, unknown>), ...patch }
  const { data } = await svc.from('mcp_jobs').update({ op_name: vers, params, updated_at: new Date().toISOString() })
    .eq('id', String(job.id)).eq('status', 'running').eq('op_name', de).select('id')
  if (data && data.length) { job.op_name = vers; job.params = params; return true }
  return false
}
// Fichiers de la carte et vidéo préparée supprimés dès que le job est fini (livré ou échoué) : photos de visage et
// vidéos personnelles ne traînent pas (la purge 7 jours reste le filet).
async function vtNettoyer(pj: Record<string, unknown>): Promise<void> {
  try {
    const rm = [pj.src_path, pj.prep_path, pj.prep_path ? String(pj.prep_path) + '.poster.jpg' : ''].map(String).filter((p) => p && p !== 'undefined')
    if (rm.length) await svc.storage.from('render-media').remove(rm)
    if (pj.char_path) await svc.storage.from('mcp-media').remove([String(pj.char_path), String(pj.char_path).replace(/-char\.jpg$/, '-char-src.jpg')])
  } catch (_) { /* best effort */ }
}
async function vtEchec(job: Record<string, unknown>, msg: string, onlyOp?: string): Promise<void> {
  const pj = (job.params || {}) as Record<string, unknown>
  const op = onlyOp ?? String(job.op_name || '')
  // message lisible écrit SEULEMENT si l'étape observée est encore en place (jamais sur un job qu'un autre suivi fait avancer)
  let q = svc.from('mcp_jobs').update({ params: { ...pj, user_msg: msg } }).eq('id', String(job.id)).eq('status', 'running')
  if (op) q = q.eq('op_name', op)
  await q
  const rendu = await failAndRefund(String(job.user_id), job, msg, op || undefined)
  if (rendu >= 0) await vtNettoyer(pj)
}
// Remboursement PARTIEL une seule fois par étiquette (RPC mcp_job_partial_refund : verrou, job en cours, non remboursé).
async function vtRendrePartiel(job: Record<string, unknown>, amt: number, tag: string): Promise<void> {
  if (!(amt > 0)) return
  const { error } = await svc.rpc('mcp_job_partial_refund', { p_job: String(job.id), p_amt: Math.round(amt), p_tag: tag })
  if (error) console.error('[mcp] remboursement partiel NON passé', job.id, tag, error.message)
}
async function falSoumettre(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; d: Record<string, unknown> }> {
  // panne réseau = { ok:false, status:0 } : l'appelant rend les crédits au lieu de laisser le job bloqué jusqu'au filet
  try {
    const r = await falFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({})) as Record<string, unknown>
    return { ok: r.ok && !!(d.status_url || d.request_id), status: r.status, d }
  } catch { return { ok: false, status: 0, d: {} } }
}
const falSuivi = (url: string) => fetch(url, { headers: { Authorization: `Key ${FAL_KEY}` } })
const falUrls = (path: string, d: Record<string, unknown>) => ({
  status_url: String(d.status_url || `${FAL_QUEUE}/${path}/requests/${d.request_id}/status`),
  response_url: String(d.response_url || `${FAL_QUEUE}/${path}/requests/${d.request_id}`),
})

// Soumission Motion Control (= runKlingFal de l'app : mêmes champs ; 3.0 = liaison d'identité faciale « elements »,
// renvoi sans elements si refusés).
async function soumettreKling(ver: 'v3' | 'v2.6', pro: boolean, charUrl: string, refUrl: string, prompt: string) {
  const path = falKling(ver, pro)
  const body = { image_url: charUrl, video_url: refUrl, character_orientation: 'video', keep_original_sound: true, prompt }
  let s = ver === 'v3' ? await falSoumettre(path, { ...body, elements: [{ frontal_image_url: charUrl, reference_image_urls: [charUrl] }] }) : await falSoumettre(path, body)
  if (ver === 'v3' && !s.ok && (s.status === 400 || s.status === 422)) s = await falSoumettre(path, body)
  return { ...s, path }
}
// Motion Control chez kie.ai (Axel 09/10) : même corps que kie-proxy (orientation « video », fond de l'IMAGE, 3.0 en 1080p ;
// 2.6 en 720p ou 1080p NATIF), mêmes médias et même consigne qu'avant. sansTache = kie a refusé, aucune tâche créée.
async function soumettreKlingKie(ver: 'v3' | 'v2.6', hd: boolean, charUrl: string, refUrl: string, prompt: string): Promise<{ ok: boolean; status: number; task: string; d: Record<string, unknown> }> {
  if (!kieKey()) return { ok: false, status: 503, task: '', d: { error: 'kie indisponible' } }
  const input: Record<string, unknown> = { prompt: prompt.slice(0, 2500), input_urls: [charUrl], video_urls: [refUrl], character_orientation: 'video', mode: (ver === 'v3' || hd) ? '1080p' : '720p' }
  const body = ver === 'v3'
    ? { model: 'kling-3.0/motion-control', callBackUrl: `${SUPABASE_URL}/functions/v1/kie-proxy?path=/cb`, input: { ...input, background_source: 'input_image' } }
    : { model: 'kling-2.6/motion-control', input }
  try {
    const r = await fetch(`${KIE}/api/v1/jobs/createTask`, { method: 'POST', headers: kieHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
    const j = await r.json().catch(() => ({})) as Record<string, any>
    const task = String(j?.data?.taskId || '')
    if (j?.code === 200 && /^[A-Za-z0-9_-]{6,120}$/.test(task)) return { ok: true, status: 200, task, d: j }
    return { ok: false, status: Number(j?.code) || r.status, task: '', d: { error: String(j?.msg || '') } }
  } catch { return { ok: false, status: 0, task: '', d: {} } }
}
// Durée de la vidéo préparée : le worker l'encode en +faststart → l'atome mvhd est dans le 1er Mo (lecture partielle) ;
// repli lecture complète si besoin. JAMAIS la durée annoncée par la carte (la facture ne dépend que du serveur).
async function vtDuree(prep: string): Promise<number | null> {
  const u = await signRender(prep, 600)
  if (u) {
    try {
      const r = await fetch(u, { headers: { Range: 'bytes=0-1048575' } })
      if (r.ok || r.status === 206) { const d = mp4Duree(new Uint8Array(await r.arrayBuffer())); if (d) return d }
    } catch (_) { /* repli */ }
  }
  const dl = await svc.storage.from('render-media').download(prep)
  return dl.error || !dl.data ? null : mp4Duree(new Uint8Array(await dl.data.arrayBuffer()))
}
const VT_MAX_LIVRAISON = 100_000_000   // = limite du bucket mcp-media (100 Mo) ; au-delà, refus net + crédits rendus (jamais 3 essais pour rien)

// Fait avancer un job Omni / Motion Control d'UN cran (appelé par /status, check_video et les filets). Sûr à répéter.
async function advanceVideoTool(job: Record<string, unknown>): Promise<void> {
  const userId = String(job.user_id), op = String(job.op_name || ''), pj = (job.params || {}) as Record<string, unknown>
  const outil = String(pj.tool)
  // réservation de livraison orpheline (isolate tué pendant la copie) → rendue 3 min après SA date (vdg_at), jamais d'après
  // updated_at (que /status rafraîchit toutes les 8 s : l'orphelin n'aurait jamais été libéré tant que la carte sonde)
  if (op.startsWith('vdg:')) {
    if (Date.now() - (Number(pj.vdg_at) || 0) > 180_000) {
      if ((Number(pj.deliver_try) || 0) >= 3) await vtEchec(job, 'Livraison impossible — crédits rendus.', op)
      else await vtPasser(job, op, 'vd:' + op.slice(4))
    }
    return
  }
  if (/^(vns|vmr|vur|vkr):/.test(op)) return   // réservation en cours (ou orpheline : le filet tranchera)

  // 1) PRÉPARATION faite par le serveur de rendu → durée mesurée → débit → soumission au moteur
  if (op.startsWith('vn:')) {
    const { data: rj } = await svc.from('render_jobs').select('status, output_url').eq('id', op.slice(3)).maybeSingle()
    if (!rj || rj.status === 'failed') { await vtEchec(job, 'Vidéo illisible — réexporte-la en MP4 et réessaie.'); return }
    if (rj.status !== 'done' || !rj.output_url) return
    // Audit 02/10 (MCPB-1) — CONTRAT render-worker : la vidéo préparée vit dans mcp-prep/<user_id>/<job>.mp4, HORS du dossier
    // <uid>/ que l'utilisateur peut réécrire avec sa session. Avant, elle était dans <uid>/ : remplacée entre la mesure
    // (débit) et la lecture par le moteur, une vidéo plus longue était traitée au prix de la courte. On mesure, signe et
    // envoie EXACTEMENT cette clé ; toute autre valeur → échec, rien n'est débité à ce stade (message neutre).
    const prep = clePrepMcp(userId, op.slice(3))
    if (!prep || String(rj.output_url) !== prep) {
      console.warn('[mcp] outil vidéo : sortie de préparation inattendue', job.id, String(rj.output_url).slice(0, 120))
      await vtEchec(job, 'Préparation de la vidéo impossible — réessaie dans quelques minutes.'); return
    }
    const essaisPrep = (Number(pj.prep_try) || 0) + 1
    if (!(await vtPasser(job, op, 'vns:' + op.slice(3), { prep_path: prep, prep_try: essaisPrep }))) return   // un seul suivi débite et soumet
    const dur = await vtDuree(prep)
    const refUrl = dur && dur > 0.5 ? await signRender(prep) : null
    if (!dur || !(dur > 0.5) || !refUrl) {   // stockage indisponible un instant, ou vidéo vraiment illisible : rien n'est débité
      if (essaisPrep < 3) { await vtPasser(job, 'vns:' + op.slice(3), op); return }
      await vtEchec(job, 'Vidéo illisible — réexporte-la en MP4 et réessaie.'); return
    }
    let cost = 0, sub: { ok: boolean; status: number; d: Record<string, unknown>; path: string }, prochain = ''
    const extra: Record<string, unknown> = { dur: Math.round(dur * 100) / 100 }
    if (outil === 'omni_edit') {
      const res = pj.resolution === '1080p' ? '1080p' : '720p'
      cost = Math.max(1, Math.ceil(dur - 0.05) * OMNI_EDIT_SEC[res])   // = _omniCost (−0,05 s : l'encodage ajoute quelques ms)
      const bal = await spendForJob(userId, String(job.id), cost)
      if (bal === null || bal === -1 || bal === -2) { await vtEchec(job, `Crédits insuffisants : il en faut ${cost}. Recharge sur avatarads.fr`); return }
      const p = FAL_OMNI_EDIT
      sub = { ...(await falSoumettre(p, { video_url: refUrl, prompt: omniEditPrompt(String(pj.prompt || '')), resolution: res })), path: p }
      prochain = 've:'
    } else {
      // Motion Control chez kie.ai (Axel 09/10 : pour tous, 1080p natif, PAS de repli fal) → étape vk:<tâche>
      if (!kieKey()) { await vtEchec(job, 'Motion Control momentanément indisponible — réessaie dans quelques minutes.'); return }
      const billDur = Math.min(30, Math.ceil(dur - 0.05))   // vidéo déjà prolongée à 3,6 s si besoin (= _mcRefDurEff)
      const v3 = pj.model === '3.0', hd = pj.quality === '1080p'
      cost = billDur * mcRate(pj.model, pj.quality)
      const bal = await spendForJob(userId, String(job.id), cost)
      if (bal === null || bal === -1 || bal === -2) { await vtEchec(job, `Crédits insuffisants : il en faut ${cost}. Recharge sur avatarads.fr`); return }
      const charUrl = await signPath(String(pj.char_path), 3 * 3600)
      if (!charUrl) { await vtEchec(job, 'Photo du personnage introuvable — redépose-la.'); return }
      const k = await soumettreKlingKie(v3 ? 'v3' : 'v2.6', hd, charUrl, refUrl, motionControlPrompt({ instruction: String(pj.instruction || ''), camFollow: pj.cam !== false }))
      if (!k.ok) {
        console.warn('[mcp] motion kie : soumission refusée', job.id, k.status, JSON.stringify(k.d).slice(0, 300))
        await vtEchec(job, (k.status === 0 || k.status === 402 || k.status === 429 || k.status === 433 || k.status >= 455) ? 'Service vidéo momentanément indisponible — crédits rendus, réessaie dans quelques minutes.' : erreurKling(k.d, k.status).msg); return
      }
      await vtPasser(job, 'vns:' + op.slice(3), 'vk:' + k.task, { ...extra, bill_dur: billDur, ver: v3 ? 'v3' : 'v2.6', char_url: charUrl, ref_url: refUrl, bill: cost })
      return
    }
    if (!sub.ok) {
      console.warn('[mcp] outil vidéo : soumission refusée', job.id, sub.status, JSON.stringify(sub.d).slice(0, 300))
      await vtEchec(job, (sub.status === 0 || sub.status === 402 || sub.status >= 500) ? 'Service vidéo momentanément indisponible — crédits rendus, réessaie dans quelques minutes.' : erreurKling(sub.d, sub.status).msg); return
    }
    await vtPasser(job, 'vns:' + op.slice(3), prochain + String(sub.d.request_id || ''), { ...extra, fal: falUrls(sub.path, sub.d), bill: cost })
    return
  }

  // 3) LIVRAISON (résultat prêt chez le moteur) : copie dans mcp-media + Bibliothèque, réservée, 3 essais
  if (op.startsWith('vd:')) {
    const url = String(pj.result_src || '')
    if (!url) { await vtEchec(job, 'Livraison impossible — crédits rendus.'); return }
    if (pj.deliver_at && Date.now() - Number(pj.deliver_at) < 60_000) return   // essais espacés d'une minute (panne passagère)
    const essais = (Number(pj.deliver_try) || 0) + 1
    if (!(await vtPasser(job, op, 'vdg:' + op.slice(3), { vdg_at: Date.now(), deliver_try: essais, deliver_first: pj.deliver_first || Date.now() }))) return
    let ok = false
    try {
      const v = await fetch(url)
      const len = Number(v.headers.get('content-length')) || 0
      if (v.ok && len > VT_MAX_LIVRAISON) { await vtEchec(job, 'Vidéo trop lourde pour être livrée — crédits rendus.'); return }
      if (v.ok) ok = !!(await deliverVideo(userId, job, new Uint8Array(await v.arrayBuffer())))
    } catch (_) { /* nouvel essai */ }
    if (ok) { await vtNettoyer(pj); return }
    const { data: st } = await svc.from('mcp_jobs').select('status').eq('id', String(job.id)).maybeSingle()
    if (st?.status === 'done') { await vtNettoyer(pj); return }   // livrée par un autre passage
    if (essais >= 3 && Date.now() - Number(job.params && (job.params as Record<string, unknown>).deliver_first || Date.now()) > 5 * 60_000) { await vtEchec(job, 'Livraison impossible — crédits rendus.', 'vdg:' + op.slice(3)); return }
    await vtPasser(job, 'vdg:' + op.slice(3), 'vd:' + op.slice(3), { deliver_at: Date.now() })
    return
  }

  // 2 bis) SUIVI de Motion Control chez kie (vk:<tâche>) : prêt → livraison (vd:) ; échec → crédits rendus, sauf la 3.0
  //        refusée par la modération : UNE reprise en 2.6 1080p chez kie, la différence de prix rendue (6 → 3 cr/s).
  if (op.startsWith('vk:')) {
    const rec = await kieRecord('mk', op.slice(3))
    if (rec.transient || !rec.found || rec.state === 'queue' || rec.state === 'run') return   // passager / en cours : le filet VT_STALE_MIN tranche
    if (rec.state === 'ok' && rec.urls.length) { await vtPasser(job, op, 'vd:' + op.slice(3), { result_src: rec.urls[0] }); return }
    const e = erreurKling({ error: `${rec.errType} ${rec.err}`.trim() || 'échec' }, 0)
    console.warn('[mcp] motion kie : échec', job.id, rec.errType, String(rec.err).slice(0, 300))
    if (pj.ver === 'v3' && e.moderation) {
      if (!(await vtPasser(job, op, 'vkr:' + op.slice(3)))) return
      const k = await soumettreKlingKie('v2.6', true, String(pj.char_url), String(pj.ref_url), motionControlPrompt({ instruction: String(pj.instruction || ''), camFollow: pj.cam !== false }))
      if (k.ok) {
        await vtRendrePartiel(job, (MC_SEC.v3 - MC_SEC.v26pro) * (Number(pj.bill_dur) || 0), 'repli-2.6')
        await vtPasser(job, 'vkr:' + op.slice(3), 'vk:' + k.task, { ver: 'v2.6-pro', repli: true })
        return
      }
      await vtEchec(job, e.msg, 'vkr:' + op.slice(3)); return
    }
    await vtEchec(job, e.msg, op); return
  }

  // 2) SUIVI du moteur (Omni, Kling ou Topaz)
  const fal = (pj.fal || {}) as { status_url?: string; response_url?: string }
  if (!fal.status_url || !fal.response_url) return
  const st = await falSuivi(fal.status_url).catch(() => null)
  if (!st || !st.ok) return
  const sd = await st.json().catch(() => ({})) as Record<string, unknown>
  const s = String(sd.status || '').toUpperCase()
  if (s === 'IN_QUEUE' || s === 'IN_PROGRESS' || !s) return
  let rd: Record<string, unknown> = {}, rOk = false, rStatus = 0
  if (s === 'COMPLETED') {
    const rr = await falSuivi(fal.response_url).catch(() => null)
    if (!rr || rr.status === 429 || rr.status >= 500) return   // passager : on relira au passage suivant
    rStatus = rr.status; rOk = rr.ok; rd = await rr.json().catch(() => ({})) as Record<string, unknown>
  }
  else rd = sd
  const vu = String((rd?.video as { url?: string })?.url || rd?.video_url || (rd?.output as { video?: { url?: string } })?.video?.url || '')
  if (s === 'COMPLETED' && rOk && vu) {
    // Motion 2.6 en 1080p : upscale Topaz (comme l'app) ; échec de soumission → 720p livré, supplément rendu
    if (op.startsWith('vm:') && pj.quality === '1080p' && pj.ver === 'v2.6' && pj.model !== '3.0') {
      if (!(await vtPasser(job, op, 'vur:' + op.slice(3), { kling_url: vu }))) return
      const t = await falSoumettre(FAL_TOPAZ, { video_url: vu, upscale_factor: 1.5, H264_output: true })
      if (t.ok) { await vtPasser(job, 'vur:' + op.slice(3), 'vu:' + String(t.d.request_id || ''), { fal: falUrls(FAL_TOPAZ, t.d) }); return }
      await vtRendrePartiel(job, MC_SEC.topaz * (Number(pj.bill_dur) || 0), 'topaz')
      await vtPasser(job, 'vur:' + op.slice(3), 'vd:' + op.slice(3), { result_src: vu })
      return
    }
    await vtPasser(job, op, 'vd:' + op.slice(3), { result_src: vu })
    return
  }
  // échec du moteur
  if (op.startsWith('vu:')) {   // Topaz raté → le rendu Kling (payé) est livré en 720p, le supplément 1080p rendu
    if (!(await vtPasser(job, op, 'vur:' + op.slice(3)))) return
    await vtRendrePartiel(job, MC_SEC.topaz * (Number(pj.bill_dur) || 0), 'topaz')
    if (pj.kling_url) { await vtPasser(job, 'vur:' + op.slice(3), 'vd:' + op.slice(3), { result_src: pj.kling_url }); return }
    await vtEchec(job, 'Livraison impossible — crédits rendus.', 'vur:' + op.slice(3)); return
  }
  const e = erreurKling(rd, rStatus)
  console.warn('[mcp] outil vidéo : échec moteur', job.id, s, rStatus, JSON.stringify(rd).slice(0, 300))
  // Motion 3.0 : faux positifs de modération fréquents → UNE reprise en 2.6 pro, refacturée au tarif 2.6 (6 → 4 cr/s)
  if (op.startsWith('vm:') && pj.ver === 'v3' && e.moderation) {
    if (!(await vtPasser(job, op, 'vmr:' + op.slice(3)))) return
    const k = await soumettreKling('v2.6', true, String(pj.char_url), String(pj.ref_url), motionControlPrompt({ instruction: String(pj.instruction || ''), camFollow: pj.cam !== false }))
    if (k.ok) {
      await vtRendrePartiel(job, (MC_SEC.v3 - MC_SEC.v26pro) * (Number(pj.bill_dur) || 0), 'repli-2.6')
      await vtPasser(job, 'vmr:' + op.slice(3), 'vm:' + String(k.d.request_id || ''), { ver: 'v2.6-pro', repli: true, fal: falUrls(k.path, k.d) })
      return
    }
  }
  await vtEchec(job, op.startsWith('ve:') ? (e.moderation ? 'Transformation refusée par la modération (souvent une marque ou un logo) — reformule et réessaie.' : 'La transformation a échoué — crédits rendus, réessaie.') : e.msg, String(job.op_name))   // étape COURANTE (vmr: si le repli a échoué)
}

// ── Outils edit_video (module Omni) et motion_control (module Motion Control) ──
// Job créé « pending » (rien débité) + carte de dépôt ; une vidéo/photo déjà en ligne (video_url / image_url, ex. un
// résultat AvatarAds de cette conversation) est copiée côté serveur et pré-remplie dans la carte.
async function vtCopierSource(userId: string, jobId: string, url: string, quoi: 'video' | 'image'): Promise<{ bucket: string; path: string } | string> {
  let parsed: URL | null = null
  try { parsed = new URL(url) } catch { /* invalide */ }
  if (!parsed || !/^https?:$/.test(parsed.protocol) || isBlockedHost(parsed.hostname)) return `${quoi === 'video' ? 'video_url' : 'image_url'} doit être une URL http(s) publique.`
  // 60 Mo au plus pour une vidéo par lien : elle est copiée pendant l'appel d'outil (mémoire edge 256 Mo, relais coupé
  // vers 8 s) — plus lourde, l'utilisateur la dépose dans la carte (envoi direct au stockage, jusqu'à 200 Mo)
  const got = await fetchUserFile(url, quoi === 'video' ? 60_000_000 : 15_000_000, quoi === 'video' ? /^(video\/(mp4|quicktime|webm|x-m4v)|application\/octet-stream)/ : /^image\/(png|jpe?g|webp)$/, quoi === 'video' ? 'la vidéo (video_url)' : 'la photo (image_url)')
  if (typeof got === 'string') return got
  const ext = quoi === 'video' ? (/webm/.test(got.contentType) ? 'webm' : /quicktime/.test(got.contentType) ? 'mov' : 'mp4') : (/png/.test(got.contentType) ? 'png' : /webp/.test(got.contentType) ? 'webp' : 'jpg')
  const bucket = quoi === 'video' ? 'render-media' : 'mcp-media'
  const path = `${userId}/mcp-src/${jobId}-${quoi === 'video' ? 'src' : 'char-src'}.${ext}`
  const { error } = await svc.storage.from(bucket).upload(path, got.bytes, { contentType: got.contentType, upsert: true })
  return error ? 'Copie du fichier impossible — réessaie.' : { bucket, path }
}
async function vtCarte(profile: Record<string, unknown>, tool: 'omni_edit' | 'motion', params: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent | { job: string; cap: string; extra: Record<string, unknown> }> {
  const userId = String(profile.id)
  // cartes gratuites tant que rien n'est lancé : 30 par heure et par compte au plus (audit 02/10)
  if (!isUnlimited(profile) && !(await rateHit('mcp-vtcarte:' + userId, 3600, 30))) return toolErr('Trop de cartes ouvertes cette heure-ci — utilise une carte déjà affichée ou réessaie plus tard.')
  const { data: pj, error } = await svc.from('mcp_jobs').insert({ user_id: userId, kind: 'avatar', status: 'pending', credits_cost: 0, params: { video: true, tool, ...params } }).select('id').single()
  if (error || !pj) return toolErr('Erreur serveur — réessaie.')
  const extra: Record<string, unknown> = {}
  const vUrl = String(args.video_url || '').trim()
  if (vUrl) {
    const c = await vtCopierSource(userId, pj.id, vUrl, 'video')
    if (typeof c === 'string') { await svc.from('mcp_jobs').update({ status: 'failed', error: 'source refusée' }).eq('id', pj.id); return toolErr(c) }
    await svc.from('mcp_jobs').update({ params: { video: true, tool, ...params, src_path: c.path } }).eq('id', pj.id)
    params.src_path = c.path; extra.refSrc = await signRender(c.path, 2 * 3600)
  }
  const iUrl = tool === 'motion' ? String(args.image_url || '').trim() : ''
  if (iUrl) {
    const c = await vtCopierSource(userId, pj.id, iUrl, 'image')
    if (typeof c === 'string') { await svc.from('mcp_jobs').update({ status: 'failed', error: 'source refusée' }).eq('id', pj.id); return toolErr(c) }
    extra.charSrc = await signPath(c.path, 2 * 3600)
  }
  return { job: pj.id, cap: await jobCap(pj.id), extra }
}

async function runEditVideo(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  if (!FAL_KEY) return toolErr('Édition vidéo indisponible (configuration serveur incomplète).')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) return toolErr('Le paramètre "prompt" est requis : décris LA transformation (une seule à la fois).')
  const resolution = args.quality === '1080p' ? '1080p' : '720p'
  const rate = OMNI_EDIT_SEC[resolution]
  const maxDur = Math.min(10, Math.max(1, Math.round(Number(args.duration_seconds) || 10)))   // N premières secondes (10 s natifs)
  const c = await vtCarte(profile, 'omni_edit', { prompt: prompt.slice(0, 2000), resolution, max_dur: maxDur }, args)
  if ('content' in c) return c
  return {
    content: [{ type: 'text', text: `[système] Carte Omni prête : ${c.extra.refSrc ? 'la vidéo fournie est déjà chargée, la transformation part toute seule' : "l'utilisateur dépose sa vidéo (1 à 10 s) dans la carte, la transformation se lance aussitôt"} (${resolution}, ${rate} crédits/seconde, durée arrondie à la seconde supérieure — ex. 8 s = ${8 * rate} crédits ; débités au lancement, rendus si échec).\nRÉPONSE À ÉCRIRE MAINTENANT : une seule phrase courte, par ex. « Dépose ta vidéo dans la carte, la transformation se lance toute seule. » N'appelle aucun autre outil pour cette vidéo.` }],
    structuredContent: { job_id: c.job, cap: c.cap, statusUrl: `https://mcp.avatarads.fr/status/${c.job}`, kind: 'video', pending: true, tool: 'edit', rate, maxDur, prompt, ...c.extra },
  }
}

async function runMotionControl(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  if (!kieKey()) return toolErr('Motion Control indisponible (configuration serveur incomplète).')
  const model = args.model === '3.0' ? '3.0' : '2.6'
  const quality = model === '3.0' || args.quality === '1080p' ? '1080p' : '720p'
  const plan = String(profile.plan || '').toLowerCase()
  if ((model === '3.0' || quality === '1080p') && !isUnlimited(profile) && !MC_PRO_PLANS.includes(plan)) {
    return toolErr(`${model === '3.0' ? 'Motion 3.0' : 'Le 1080p'} est réservé aux plans Pro et Élite (plan actuel : ${plan || 'free'}). Relance en Motion 2.6 720p, ou passe en Pro sur ${APP_URL}`)
  }
  const rate = mcRate(model, quality)
  const instruction = String(args.instruction || '').trim().slice(0, 800)
  const maxDur = Math.min(30, Math.max(4, Math.round(Number(args.duration_seconds) || 30)))   // N premières secondes de la référence (≥ 4 : la rallonge à 3,6 s doit tenir)
  const c = await vtCarte(profile, 'motion', { model, quality, instruction, cam: args.realistic_camera !== false, max_dur: maxDur }, args)
  if ('content' in c) return c
  return {
    content: [{ type: 'text', text: `[système] Carte Motion Control prête (Motion ${model}, ${quality}, ${rate} crédits/seconde de la vidéo de référence, 3 à 30 s — ex. 10 s = ${10 * rate} crédits ; débités au lancement, rendus si échec). L'utilisateur dépose dans la carte ${c.extra.charSrc ? '' : 'la photo du personnage puis '}${c.extra.refSrc ? '' : 'la vidéo de référence (le mouvement à copier)'} ; le cadrage est ajusté automatiquement et la génération se lance toute seule (compte 3 à 10 min).\nRÉPONSE À ÉCRIRE MAINTENANT : une seule phrase courte, par ex. « Dépose la photo du personnage et la vidéo de référence dans la carte, la vidéo se lance toute seule. » N'appelle aucun autre outil pour cette vidéo.` }],
    structuredContent: { job_id: c.job, cap: c.cap, statusUrl: `https://mcp.avatarads.fr/status/${c.job}`, kind: 'video', pending: true, tool: 'motion', rate, maxDur, ...c.extra },
  }
}

async function advanceAvatarJob(job: Record<string, unknown>): Promise<void> {
  try {
    const userId = String(job.user_id)
    if (estOutilVideo(job.op_name)) { await advanceVideoTool(job); return }   // Omni / Motion Control (02/10)
    // OmniHuman chez kie (Axel 25/09) : op_name « oh1:… » (en cours → rien ; le filet tranche à KIE_OMNI_STALE_MIN)
    if (estOmniKie(job.op_name)) {
      const pj = (job.params || {}) as Record<string, unknown>
      // RETOUCHE en cours (vidéo Express Omni Flash) : on attend le serveur de rendu, sans redemander la vidéo à kie
      if (pj.retouche_job) { await suivreRetouche(userId, job, pj); return }
      const a = await avancerOmniKie(taskDeOp(job.op_name))
      if (a.etat === 'echec') await failAndRefund(userId, job, a.raison)
      else if (a.etat === 'pret') {
        if (pj.video && pj.stage_path && !(await lancerRetouche(userId, job, pj, a.bytes))) await deliverVideo(userId, job, a.bytes)
        else if (!(pj.video && pj.stage_path)) await deliverVideo(userId, job, a.bytes)
      }
      return
    }
    // OmniHuman (fal) : op_name préfixé « fal: »
    if (String(job.op_name || '').startsWith('fal:')) {
      const reqId = String(job.op_name).slice(4)
      let st = await falFetch(`${FAL_OMNI_APP}/requests/${reqId}/status`)
      if (!st.ok) st = await falFetch(`${FAL_OMNI_PATH}/requests/${reqId}/status`)
      if (!st.ok) return
      const sd = await st.json().catch(() => ({})) as Record<string, unknown>
      const s = String(sd.status || '').toUpperCase()
      if (s === 'IN_QUEUE' || s === 'IN_PROGRESS' || !s) return
      if (s !== 'COMPLETED') { await failAndRefund(userId, job, `fal ${s}`); return }
      let rr = await falFetch(`${FAL_OMNI_APP}/requests/${reqId}`)
      if (!rr.ok) rr = await falFetch(`${FAL_OMNI_PATH}/requests/${reqId}`)
      const rd = (rr.ok ? await rr.json().catch(() => ({})) : {}) as Record<string, unknown>
      const vu = (rd?.video as { url?: string })?.url || (rd?.video_url as string) || ''
      if (!vu) { await failAndRefund(userId, job, 'video_missing'); return }
      const vres = await fetch(vu).catch(() => null)
      if (!vres || !vres.ok) return
      await deliverVideo(userId, job, new Uint8Array(await vres.arrayBuffer()))
      return
    }
    // Hedra v3 : op_name préfixé « v3: »
    if (String(job.op_name || '').startsWith('v3:')) {
      const rv = await hedraV3StatusUrl(String(job.op_name).slice(3))
      if (rv.failed) { await failAndRefund(userId, job, rv.err || 'échec'); return }
      if (!rv.url) return
      const vr = await fetch(rv.url).catch(() => null)
      if (!vr || !vr.ok) return
      await deliverVideo(userId, job, new Uint8Array(await vr.arrayBuffer()))
      return
    }
    // Hedra Character-3 (ancienne API, jobs hérités)
    const res = await hedraFetch(`/generations/${job.op_name}/status`, { method: 'GET' })
    if (!res.ok) return
    const d = await res.json().catch(() => ({})) as Record<string, unknown>
    const status = String(d.status || d.state || '').toLowerCase()
    if (['queued', 'processing', 'finalizing', 'pending'].includes(status) || !status) return
    if (!['complete', 'completed', 'succeeded'].includes(status)) {
      await failAndRefund(userId, job, String(d.error || d.error_message || `statut ${status}`)); return
    }
    const videoUrl = String(d.url || d.download_url || d.video_url || d.streaming_url || '')
    if (!videoUrl) { await failAndRefund(userId, job, 'video_missing'); return }
    const vRes = await fetch(videoUrl).catch(() => null)
    if (!vRes || !vRes.ok) return
    await deliverVideo(userId, job, new Uint8Array(await vRes.arrayBuffer()))
  } catch { /* on retente au prochain poll */ }
}

// ── Nettoyage audio : serveur de rendu d'abord, ElevenLabs en secours ──
// ── LE NETTOYAGE DE LA VOIX, PARTAGÉ ────────────────────────────────────────
// Utilisé par clean_audio ET par le Montage IA (étape 0). Renvoie les octets
// nettoyés (MP3), ou une chaîne d'erreur (jamais d'exception : l'appelant décide
// s'il abandonne ou s'il continue avec l'audio d'origine). Le détail — worker
// Railway (AUDIO_CLEAN_URL / AUDIO_CLEAN_KEY, https, délai de 15 à 40 s selon la taille), repli ElevenLabs
// journalisé « [clean] repli ElevenLabs » — est dans nettoyage-voix.ts.
async function isolerVoix(bytes: Uint8Array, contentType: string): Promise<Uint8Array | string> {
  return await nettoyerVoix(bytes, contentType, NETTOYAGE)
}

// Audit 02/10 : durée MESURÉE d'un audio reçu, en secondes — WAV PCM / MP3 (mesurerAudio : copie canonique, trames comptées)
// et M4A / MP4 / MOV (dureeMp4Octets : la plus longue des durées déclarées, pistes vues comme ffmpeg) ; la plus longue des
// lectures qui réussissent. null = format non mesurable : jamais la durée annoncée.
// Audit 04/10 (MCP-4) : + FLAC, Ogg Opus (notes vocales), WebM Opus (enregistreur des navigateurs) et AAC brut (ADTS),
// mesurés sur les trames réellement décodables (dureeAudioAutres) — refusés au-delà de 1,2 / 3 Mo depuis le 03/10.
function dureeAudioMesuree(b: Uint8Array): number | null {
  const m = mesurerAudio(b), mp4 = dureeMp4Octets(b), autre = dureeAudioAutres(b)
  if (!m.kind && mp4 === null && !autre) return null
  return Math.max(m.kind ? m.sec : 0, mp4 ?? 0, autre ? autre.sec : 0)
}
// Audit 02/10 : au-delà de ces tailles, un format non mesurable est refusé (sa durée ne serait qu'une estimation) —
// nettoyage : 1,2 Mo ≈ 10 min à 16 kbit/s (voix Opus / AAC-HE), ~75 s à 128 kbit/s : la limite de 10 min ne se dépasse plus
// qu'en dessous de 16 kbit/s ; Montage IA : 3 Mo (l'estimation sur la taille borne déjà à ~90 s × 128 kbit/s ≈ 1,4 Mo).
const CLEAN_NON_MESURE_MAX = 1_200_000
const MONTAGE_NON_MESURE_MAX = 3_000_000
const CLEAN_MAX_SEC = 10 * 60   // limite annoncée de clean_audio (10 min), sur la durée MESURÉE

// Coût du nettoyage pour un fichier donné.
// minutes facturées : durée MESURÉE pour WAV / MP3 / M4A / MP4 (audit 02/10 ; 0,5 s de tolérance en faveur du client : retard
// d'encodeur AAC), sinon ~960 Ko/min (MP3 128 kbit/s). `sec` déjà mesuré : passé tel quel (null = non mesurable).
const minutesNettoyage = (b: Uint8Array, sec: number | null = dureeAudioMesuree(b)) =>
  Math.max(1, sec !== null ? Math.ceil(Math.max(0, sec - 0.5) / 60) : Math.ceil(b.length / 960_000))
const coutNettoyage = (b: Uint8Array, sec: number | null = dureeAudioMesuree(b)) => minutesNettoyage(b, sec) * CLEAN_COST_PER_MIN

async function runCleanAudio(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!nettoyageDisponible(NETTOYAGE)) return toolErr('Nettoyage audio indisponible (configuration serveur incomplète).')
  const audioUrl = String(args.audio_url || '').trim()
  if (!audioUrl) return toolErr('Le paramètre "audio_url" est requis.')
  const got = await fetchUserFile(audioUrl, CLEAN_MAX_BYTES, /^(audio\/|video\/mp4|application\/octet-stream)/, "le fichier audio (audio_url)")
  if (typeof got === 'string') return toolErr(got)

  // Durée MESURÉE quand on sait la lire (WAV PCM, MP3 : trames comptées) — audit 02/10 : estimée sur la taille, un MP3 de
  // 10 min à 16 kbit/s coûtait 2 crédits au lieu de 10. Audit 02/10 : M4A / MP4 mesurés aussi (dureeMp4Octets) ; un format
  // non mesurable n'est accepté que petit (estimation sur la taille, comme avant) ; la limite de 10 min est appliquée.
  const mesSec = dureeAudioMesuree(got.bytes)
  if (mesSec === null && got.bytes.length > CLEAN_NON_MESURE_MAX) {
    return toolErr(`Format audio non pris en charge au-delà de ${(CLEAN_NON_MESURE_MAX / 1_000_000).toFixed(1).replace('.', ',')} Mo : sa durée ne peut pas être mesurée. Envoie un MP3, un WAV, un M4A, un FLAC, un OGG / Opus, un WebM ou un AAC. Aucun crédit débité.`)
  }
  if (mesSec !== null && mesSec > CLEAN_MAX_SEC + 0.5) {
    return toolErr(`Audio trop long (~${Math.ceil(mesSec / 60)} min) : le nettoyage accepte 10 minutes d'audio au plus. Découpe-le puis relance. Aucun crédit débité.`)
  }
  const estMin = minutesNettoyage(got.bytes, mesSec)
  const cost = estMin * CLEAN_COST_PER_MIN
  const userId = String(profile.id)
  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédit${cost > 1 ? 's' : ''} (~${estMin} min d'audio), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `nettoyage audio ~${estMin} min`, 'clean_audio')
  if (gate) return gate

  const bal = await spendCredits(userId, cost)
  if (bal === null || bal === -1) await capRelease(profile, ctx, cost)   // rien débité → part du plafond rendue (audit 28/09)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédit${cost > 1 ? 's' : ''}. Recharge sur ${APP_URL}`)

  // tant que la livraison n'a pas abouti, les crédits sont rendus (nettoyage, upload ou suivi en échec)
  return await nettoyerEtLivrer<ToolContent>({
    userId, cost, bytes: got.bytes, contentType: got.contentType,
    nettoyer: isolerVoix,
    rembourser: refundCredits,
    erreur: toolErr,
    livrer: async (cleaned) => {
      const url = await uploadMedia(userId, cleaned, 'mp3', 'audio/mpeg')
      await svc.from('mcp_jobs').insert({ user_id: userId, kind: 'audio_clean', status: 'done', credits_cost: cost, result_url: url })
      await saveToLibrary(userId, cleaned, 'mp3', 'audio/mpeg', 'audio', 'Audio nettoyé')  // filet Bibliothèque (onglet Audio)
      const balTxt = isUnlimited(profile) ? '∞' : String(bal)
      return toolMedia(url, 'audio-nettoye.mp3', 'audio/mpeg', `Audio nettoyé : voix nettoyée (bruit de fond, souffle, clics).\nURL : ${url}\n−${cost} crédit${cost > 1 ? 's' : ''} · solde : ${balTxt}`)
    },
  })
}

// ── Lipsync sur audio existant (#149, brique avatar du Montage IA) ──
// Réutilise la chaîne Hedra du Générateur, mais SANS TTS : l'audio est la vraie
// voix de l'utilisateur (un segment découpé du montage). check_avatar_video
// assure le suivi (même kind 'avatar' dans mcp_jobs).
async function runLipsyncVideo(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  if (!HEDRA_API_KEY) return toolErr('Lipsync indisponible (configuration serveur incomplète).')
  const imageUrl = String(args.image_url || '').trim()
  const audioUrl = String(args.audio_url || '').trim()
  if (!imageUrl || !audioUrl) return toolErr('image_url et audio_url sont requis.')
  const aspect = ['1:1', '16:9'].includes(String(args.aspect_ratio)) ? String(args.aspect_ratio) : '9:16'
  // Override de prompt (dev/A-B test) : compte propriétaire SEULEMENT (relecture 24/09) ; sinon le prompt avatar par défaut.
  const avPrompt = (profile.is_owner === true && typeof args.prompt === 'string' && String(args.prompt).trim()) ? String(args.prompt).trim().slice(0, 2000) : AVATAR_PROMPT

  const img = await fetchUserFile(imageUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, "la photo d'avatar (image_url)")
  if (typeof img === 'string') return toolErr(img)
  const aud = await fetchUserFile(audioUrl, 15_000_000, /^(audio\/|application\/octet-stream)/, "l'audio (audio_url)")
  if (typeof aud === 'string') return toolErr(aud)

  // Défaut HEDRA (test comparatif du 27/07/2026 : à image et audio identiques, il
  // tient mieux le visage et coûte 5× moins cher). OmniHuman reste dispo en
  // explicite — son rendu figé venait au moins en partie de NOTRE prompt, qui
  // lui demandait « no camera movement » sans jamais demander de gestuelle.
  const engine = String(args.engine || 'hedra') === 'omnihuman' ? 'omnihuman' : 'hedra'
  if (engine === 'omnihuman' && !FAL_KEY && !omniKieOn()) return toolErr('OmniHuman indisponible (configuration serveur incomplète).')
  // Axel 26/09 : OmniHuman réservé aux plans Pro et Élite (jamais Starter), comme l'app et KIE_OPEN
  if (engine === 'omnihuman' && !isUnlimited(profile) && !['pro', 'elite'].includes(String(profile.plan || '').toLowerCase())) return toolErr(`OmniHuman est réservé aux plans Pro et Élite. Relance sans engine (Hedra, par défaut) ou passe à Pro sur ${APP_URL}. Aucun crédit débité.`)
  // Audit 02/10 : minimax-h3 / kling-ai-avatar-v2 (« Interne » dans le schéma : comparaisons de qualité) = compte propriétaire
  // seul, comme `prompt`. Au tarif unique de 2 cr/s, minimax générait 5 s au minimum (un segment de 1 s payait 2 crédits) et
  // coupait au-delà de 15 s ; Kling Avatar a été écarté (qualité). Aucun appel client légitime : refus net, avant tout débit.
  if (engine === 'hedra' && /^(minimax|kling)/.test(String(args.model || '')) && profile.is_owner !== true) {
    return toolErr('Ce modèle de lipsync est réservé aux tests internes. Relance sans le paramètre model (lipsync standard, le défaut). Aucun crédit débité.')
  }
  // fal refuse une image de plus de 5 Mo (file_too_large) : refus clair AVANT tout débit (un portrait 1152x2048 en PNG
  // peut dépasser cette limite ; Hedra, le moteur par défaut, l'accepte).
  if (engine === 'omnihuman' && img.bytes.length > 5_000_000) return toolErr(`OmniHuman refuse les images de plus de 5 Mo (celle-ci fait ${(img.bytes.length / 1_000_000).toFixed(1)} Mo) : relance sans engine (Hedra, par défaut) ou avec une image plus légère. Aucun crédit débité.`)
  // Durée MESURÉE (relecture 26/09) : WAV PCM → copie canonique (un seul fmt / data), MP3 → somme des trames ; tout autre
  // format est refusé AVANT tout débit. Avant : offsets fixes 22/24/34 (un chunk JUNK avant « fmt » → ~0 s facturée, plafond
  // 60 s contourné) et octets ÷ 16 000 pour le MP3 (8 kb/s → 60 s pour 20 crédits). C'est la COPIE mesurée qui part ensuite
  // chez le fournisseur (aud remplacé) : il génère exactement la durée facturée.
  const mes = mesurerAudio(aud.bytes)
  if (!mes.kind) return toolErr(`Audio refusé (${mes.error}). Aucun crédit débité.`)
  aud.bytes = mes.bytes; aud.contentType = mes.kind === 'wav' ? 'audio/wav' : 'audio/mpeg'
  const secs = Math.ceil(Math.max(1, Math.round(mes.sec * 1000) / 1000))
  // plafond sur la durée MESURÉE (un MP3 de 60 s mesure ~60,1-60,3 s : trame d'en-tête + retard d'encodeur)
  if (mes.sec > 60.5) return toolErr(`Segment audio trop long (~${Math.round(mes.sec)} s) : 60 secondes maximum par clip lipsync. Aucun crédit débité.`)
  const rate = engine === 'omnihuman' ? OMNI_COST_SEC : LIPSYNC_COST_SEC
  const cost = secs * rate
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits (~${secs} s × ${rate}), il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  const gate = await preSpendGate(profile, ctx, args, cost, `clip lipsync ~${secs} s (${engine}, ${aspect})`, 'lipsync_video')
  if (gate) return gate

  const bal = await spendCredits(userId, cost)
  if (bal === null || bal === -1) await capRelease(profile, ctx, cost)   // rien débité → part du plafond rendue (audit 28/09)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  // ── OmniHuman 1.5 (fal) : file d'attente, on garde le request_id préfixé
  //    « fal: » pour que check_avatar_video sache où poller.
  if (engine === 'omnihuman') {
    let launchedO = false
    try {
      const ext = /wav/.test(aud.contentType) ? 'wav' : 'mp3'
      const stamp = `${userId}/omni-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const upI = await svc.storage.from('mcp-media').upload(`${stamp}.png`, img.bytes, { contentType: img.contentType, upsert: true })
      const upA = await svc.storage.from('mcp-media').upload(`${stamp}.${ext}`, aud.bytes, { contentType: aud.contentType, upsert: true })
      if (upI.error || upA.error) return toolErr('Upload vers le stockage échoué — crédits remboursés.')
      const pub = async (p: string) => (await signPath(p, 6 * 3600)) || ''   // mcp-media privé : visage + voix en liens signés 6 h
      // Prompt OmniHuman PARTAGÉ (shared/omnihuman-prompts.json, ≤ 300 caractères, variante « sans mains » : pas de détection
      // ici). Fin de la règle « même prompt que Hedra » : AVATAR_PROMPT (879 caractères) dépasse la limite de kie.
      const omniPrompt = promptOmniMcp(profile.is_owner === true, args.prompt)

      // ── kie d'abord (Axel 25/09 : OmniHuman passe chez kie pour les clients). « Dernier mot » (26/09) : WAV → COPIE
      //    complétée de silence jusqu'à 0,5 s après le dernier mot, vidéo recoupée à la livraison (#cut=). `secs` (le débit)
      //    a été mesuré sur l'audio reçu : la marge est pour nous. Refus SANS tâche → repli fal ; sans réponse → remboursé.
      if (omniKieOn()) {
        // MP3 (relecture 26/09) : 0,5 s de trames de silence ajoutées à la copie, coupe à durée d’origine + 0,06 s
        const lipO = ext === 'wav' ? preparerWavHedra(aud.bytes) : (mes.kind === 'mp3' ? preparerMp3Lipsync(aud.bytes, mes.mp3) : null)
        let audioK = `${stamp}.${ext}`, coupeK = lipO && lipO.bytes === aud.bytes ? lipO.coupe : null
        if (lipO && lipO.bytes !== aud.bytes) {
          const upL = await svc.storage.from('mcp-media').upload(`${stamp}-lip.${ext}`, lipO.bytes, { contentType: aud.contentType, upsert: true })
          if (!upL.error) { audioK = `${stamp}-lip.${ext}`; coupeK = lipO.coupe }   // copie refusée → audio reçu, sans coupe
        }
        const k = await soumettreOmniKie({ imageUrl: await pub(`${stamp}.png`), audioUrl: await pub(audioK), prompt: omniPrompt })
        if (k.ok) {
          const { data: job, error } = await svc.from('mcp_jobs')
            .insert({ user_id: userId, kind: 'avatar', status: 'running', op_name: opAvecCoupe(OP_KIE_OMNI + k.taskId, coupeK), credits_cost: cost }).select('id').single()
          if (error || !job) return toolErr('Erreur serveur au suivi du job — crédits remboursés.')
          launchedO = true
          return toolText(
            `Lipsync OmniHuman lancé (~${secs} s, ${aspect}, −${cost} crédits).
job_id : ${job.id}
Appelle check_avatar_video avec ce job_id dans environ 1 minute (compte 2 à 10 minutes).`)
        }
        if (!k.sansTache) return toolErr('OmniHuman : le service de génération n’a pas répondu — crédits remboursés, réessaie dans un instant.')
        if (!FAL_KEY) { console.warn('[mcp] OmniHuman indisponible', String(k.error || '').slice(0, 300)); return toolErr('OmniHuman momentanément indisponible — crédits remboursés, réessaie dans un instant.') }   // audit 02/10 : pas d'erreur brute
        console.warn('[mcp] OmniHuman : refus sans tâche → repli fal', k.error)
      }

      const sub = await falFetch(FAL_OMNI_PATH, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: await pub(`${stamp}.png`),
          audio_url: await pub(`${stamp}.${ext}`),
          resolution: secs > 28 ? '720p' : '1080p',   // fal : 1080p limité à 30 s
          prompt: omniPrompt,   // prompt OmniHuman partagé (≤ 300), le même que chez kie
        }),
      })
      if (!sub.ok) {
        const t = await sub.text().catch(() => '')
        console.warn('[mcp] OmniHuman : soumission refusée', sub.status, t.slice(0, 300))   // audit 02/10 : le corps brut au journal seulement
        return toolErr(`Lancement du lipsync refusé (code ${sub.status}) — crédits remboursés, réessaie.`)
      }
      const sd = await sub.json().catch(() => ({}))
      const reqId = sd.request_id || sd.requestId
      if (!reqId) return toolErr("OmniHuman n'a pas retourné d'identifiant — crédits remboursés.")

      const { data: job, error } = await svc.from('mcp_jobs')
        .insert({ user_id: userId, kind: 'avatar', status: 'running', op_name: 'fal:' + reqId, credits_cost: cost }).select('id').single()
      if (error || !job) return toolErr('Erreur serveur au suivi du job — crédits remboursés.')
      launchedO = true
      return toolText(
        `🎬 Lipsync OmniHuman lancé ! (~${secs} s, ${aspect}, −${cost} crédits)
job_id : ${job.id}
Appelle check_avatar_video avec ce job_id dans environ 1 minute (compte 2 à 5 minutes).`)
    } finally {
      if (!launchedO) await refundCredits(userId, cost)
    }
  }

  let launched = false
  try {
    if (!HEDRA_V3_KEY) return toolErr('Lipsync Hedra indisponible (configuration serveur incomplète).')
    const ext = /wav/.test(aud.contentType) ? 'wav' : 'mp3'
    // 26/09 (« le dernier mot n'est pas articulé ») : Hedra Avatar / Character-3 reçoivent une COPIE du WAV complétée de
    // silence jusqu'à 0,5 s après le dernier mot ; la vidéo livrée est recoupée au dernier son + 0,06 s (deliverVideo).
    // L'audio reçu n'est jamais modifié ; `secs` (donc le débit) a été mesuré AVANT. minimax / kling : inchangé.
    // MP3 (relecture 26/09) : la chaîne native clean_audio → lipsync_video livre du MP3 → 0,5 s de trames de silence
    // ajoutées à la copie envoyée, vidéo coupée à durée d’origine + 0,06 s (même règle que le WAV, sans décodage).
    const lip = /^(minimax|kling)/.test(String(args.model || '')) ? null : (ext === 'wav' ? preparerWavHedra(aud.bytes) : (mes.kind === 'mp3' ? preparerMp3Lipsync(aud.bytes, mes.mp3) : null))
    // Hedra v3 : /v3/files (l'ancienne API web-app/public + /assets est morte → 401/404).
    const audioRef = lip ? await hedraV3Upload('segment.' + ext, lip.bytes, aud.contentType) : await hedraV3Upload('segment.' + ext, aud.bytes, aud.contentType)
    if (!audioRef) return toolErr('Upload audio vers Hedra échoué — crédits remboursés, réessaie.')
    const imageRef = await hedraV3Upload('avatar.jpg', img.bytes, img.contentType)
    if (!imageRef) return toolErr("Upload de la photo vers Hedra échoué — crédits remboursés, réessaie.")

    // Soumission v3 : POST /v3/models/<slug> { input:{ … } }. Le schéma d'entrée DIFFÈRE
    // selon le modèle (vérifié via GET /v3/models/<slug>) :
    //  - hedra-avatar / hedra-character-3 : resolution 540/720/1080p, audio (singulier)
    //  - minimax-h3 / -max-turbo : resolution 480p/768p/2K/4K (PAS de 1080p), audios[] (tableau), duration_ms (enum 5000..15000)
    //  - kling-ai-avatar-v2 : resolution 720p uniquement, audio (singulier), quality standard|pro
    const ALLOWED = ['hedra-avatar', 'hedra-character-3', 'minimax-h3', 'minimax-h3-max-turbo', 'kling-ai-avatar-v2']
    const slug = ALLOWED.includes(String(args.model)) ? String(args.model) : HEDRA_V3_SLUG
    let input: Record<string, unknown>
    if (slug === 'minimax-h3' || slug === 'minimax-h3-max-turbo') {
      const durMs = Math.min(15000, Math.max(5000, Math.ceil(secs) * 1000))   // enum 5000..15000 par pas de 1000
      input = { prompt: avPrompt, aspect_ratio: aspect, resolution: '768p', start_image: imageRef, audios: [audioRef], duration_ms: durMs }
    } else if (slug === 'kling-ai-avatar-v2') {
      input = { prompt: avPrompt, aspect_ratio: aspect, resolution: '720p', start_image: imageRef, audio: audioRef, quality: 'standard' }
    } else {
      input = { prompt: avPrompt, aspect_ratio: aspect, resolution: '1080p', start_image: imageRef, audio: audioRef }
    }
    const sub = await hedraV3Fetch('/v3/models/' + slug, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    })
    if (!sub.ok) {
      const t = await sub.text().catch(() => '')
      console.warn('[mcp] lipsync : soumission refusée', slug, sub.status, t.slice(0, 300))   // audit 02/10 : le corps brut au journal seulement
      return toolErr(`Lancement du lipsync refusé (code ${sub.status}) — crédits remboursés, réessaie.`)
    }
    const sd = await sub.json().catch(() => ({})) as { job_id?: string; id?: string }
    const jobId = sd.job_id || sd.id
    if (!jobId) return toolErr("Hedra n'a pas retourné d'ID de génération — crédits remboursés.")

    // op_name préfixé « v3: » → check_avatar_video / advanceAvatarJob / reconcile pollent en v3.
    const { data: job, error } = await svc.from('mcp_jobs')
      .insert({ user_id: userId, kind: 'avatar', status: 'running', op_name: opAvecCoupe('v3:' + String(jobId), lip && lip.coupe), credits_cost: cost }).select('id').single()
    if (error || !job) return toolErr('Erreur serveur au suivi du job — crédits remboursés, réessaie.')
    launched = true
    return toolText(
      `🎬 Lipsync lancé ! (~${secs} s, ${aspect}, −${cost} crédits)
job_id : ${job.id}
Appelle check_avatar_video avec ce job_id dans environ 1 minute (compte 2 à 5 minutes).`)
  } finally {
    if (!launched) await refundCredits(userId, cost)
  }
}

// ── Montage IA + Éditeur via Claude (#125) ──
// Le chef d'orchestre (edge orchestrate) fait transcription + plan ; le rendu part
// dans render_jobs, consommé par le moteur de rendu serveur. La mémoire de marque
// n'est pas lue ici (l'appel interne passe avec la clé anon) — le brief la remplace.

// Durée de l'audio : exacte pour un WAV (en-tête RIFF), estimée sinon.
// Pas grave si approximative : le moteur de rendu recale plan.duration sur la durée réelle.
function estimateAudioSeconds(bytes: Uint8Array, contentType: string): number {
  if (bytes.length > 44 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    // WAV : durée = octets de données ÷ (sampleRate × canaux × octets/échantillon) — les champs de FORMAT que le
    // fournisseur décode RÉELLEMENT. On n'utilise PLUS byteRate (offset 28) : il est ignoré au décodage et forgeable
    // (audit MCP 14/09 : un byteRate énorme faisait facturer ~1 crédit un WAV de plusieurs minutes / passer le plafond 60 s).
    const ch = (bytes[22] | (bytes[23] << 8)) || 1
    const sr = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24)) >>> 0
    const bytesPerSample = Math.max(1, Math.floor(((bytes[34] | (bytes[35] << 8)) || 16) / 8))
    const bps = sr * ch * bytesPerSample
    if (bps > 0) return (bytes.length - 44) / bps
  }
  const bps = /mp4|m4a|aac/.test(contentType) ? 12_000 : 16_000 // M4A ~96 kbps, MP3 ~128 kbps (résidu : sous-estime un fichier à très bas débit — fermé pour le WAV)
  return bytes.length / bps
}

// Audit 04/10 (MCP-3) : MÊME plafond que render-job pour l'app — 2 rendus en file ou en cours par compte, toutes compositions
// confondues, jobs de moins de 45 min (au-delà : morts, render-job les clôt) — compté AVANT le débit de montage_ia /
// render_montage_plan, puis revérifié à l'insertion du render_job (crédits rendus). Les montages MCP encore en préparation
// (chef d'orchestre, render_job pas encore créé) comptent aussi : sinon N montage_ia lancés d'un coup passaient tous.
// null = lecture impossible → refus (aucun crédit débité à ce stade).
const MAX_RENDUS_EN_COURS = 2
const RENDUS_EN_COURS_MSG = "Tu as déjà 2 rendus de montage en cours sur ton compte : attends qu'un des deux se termine (check_montage), puis relance."
// Audit 04/10 (relecture) : une préparation ne compte que 20 min — au-delà elle est morte (isolate tué, op_name jamais
// posé) et check_montage / le filet de réconciliation la clôturent (« préparation du plan bloquée », crédits rendus) ;
// une vraie préparation dure ~2 min. Avant : un fantôme bloquait montage_ia jusqu'à 45 min.
async function rendusEnCours(userId: string, avecPreparations = true): Promise<number | null> {
  const limite = new Date(Date.now() - 45 * 60 * 1000).toISOString()
  const limitePrep = new Date(Date.now() - 20 * 60 * 1000).toISOString()
  try {
    const { count: rendus, error: e1 } = await svc.from('render_jobs').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).in('status', ['queued', 'rendering']).gte('created_at', limite)
    if (e1) { console.error('[mcp] rendus en cours : ' + e1.message); return null }
    if (!avecPreparations) return rendus ?? 0
    const { count: preps, error: e2 } = await svc.from('mcp_jobs').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('kind', 'montage').eq('status', 'running').is('op_name', null).gte('created_at', limitePrep)
    if (e2) { console.error('[mcp] montages en préparation : ' + e2.message); return null }
    return (rendus ?? 0) + (preps ?? 0)
  } catch (e) { console.error('[mcp] rendus en cours : ' + ((e as Error)?.message || e)); return null }
}

// Crée la paire (render_jobs + mcp_jobs) — op_name du mcp_job = id du render_job.
async function createMontageJobs(
  userId: string, plan: Record<string, unknown>, inputPath: string,
  assets: unknown[], cost: number,
): Promise<{ jobId: string } | string> {
  // Audit 04/10 (MCP-3) : revérifié juste avant l'insertion (deux appels simultanés) — l'appelant rend les crédits.
  const enCours = await rendusEnCours(userId, false)
  if (enCours === null) return 'Erreur serveur à la création du job de rendu — crédits remboursés.'
  if (enCours >= MAX_RENDUS_EN_COURS) return RENDUS_EN_COURS_MSG + ' Crédits remboursés.'
  const { data: rj, error } = await svc.from('render_jobs')
    .insert({ user_id: userId, status: 'queued', plan, input_video: inputPath, assets })
    .select('id').single()
  if (error || !rj) return 'Erreur serveur à la création du job de rendu — crédits remboursés.'
  const { data: mj, error: e2 } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'montage', status: 'running', op_name: String(rj.id), credits_cost: cost })
    .select('id').single()
  if (e2 || !mj) {
    // pas de suivi possible → on annule le rendu pour ne pas travailler dans le vide
    await svc.from('render_jobs').update({ status: 'failed', error: 'suivi mcp indisponible' }).eq('id', rj.id)
    return 'Erreur serveur au suivi du job — crédits remboursés.'
  }
  return { jobId: String(mj.id) }
}

async function runMontageIA(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  const audioUrl = String(args.audio_url || '').trim()
  if (!audioUrl) return toolErr('Le paramètre "audio_url" est requis.')
  const style = MONTAGE_STYLES.includes(String(args.style)) ? String(args.style) : 'dynamic'
  const brief = String(args.brief || '').trim().slice(0, 700)
  const script = String(args.script || '').trim().slice(0, 4000)
  const got = await fetchUserFile(audioUrl, MONTAGE_MAX_BYTES, /^(audio\/|video\/mp4|application\/octet-stream)/, "l'audio (audio_url)")
  if (typeof got === 'string') return toolErr(got)

  // ── SA PHOTO ET SES MÉDIAS, LANCÉS DEPUIS CLAUDE ──────────────────────────
  // Un montage MCP partait toujours SANS visage et SANS ses images : le worker
  // sait les consommer (asset « avatar » à la racine, le reste en b-roll), le
  // serveur MCP ne les envoyait simplement jamais. On les télécharge AVANT le
  // débit : une URL cassée doit échouer sans rien coûter.
  const avatarUrl = String(args.avatar_url || '').trim()
  let avatarFile: { bytes: Uint8Array; contentType: string } | null = null
  if (avatarUrl) {
    const av = await fetchUserFile(avatarUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, "la photo d'avatar (avatar_url)")
    if (typeof av === 'string') return toolErr(av)
    avatarFile = av
  }
  // #84 · POOL de visages pour la ROTATION : `avatar_urls` = d'autres photos du
  // MÊME perso (angles/tenues). Chacune devient avatar-1, avatar-2… et le worker
  // en pose une DIFFÉRENTE par fenêtre. Téléchargées AVANT le débit (URL cassée
  // = 0 crédit). Sans pool, comportement d'avant (une seule image partout).
  const avatarPoolFiles: { bytes: Uint8Array; contentType: string }[] = []
  {
    let poolArg: unknown = args.avatar_urls
    if (typeof poolArg === 'string') { try { poolArg = JSON.parse(poolArg) } catch (_) { poolArg = [poolArg] } }
    if (poolArg && !Array.isArray(poolArg)) poolArg = [poolArg]
    const dejaVues = new Set([String(args.avatar_url || '').trim()])
    for (const u of (Array.isArray(poolArg) ? poolArg : []).slice(0, 5)) {
      const url = String(u || '').trim()
      // ⚠ un client qui remet avatar_url en tête d'avatar_urls créait un pool
      // [tom, tom, tom2, tom3] → le hook ET la fenêtre suivante portaient la
      // MÊME photo (Axel, 14/08 : « la 2e fois qu'on voit l'avatar ça doit être
      // un autre que celui du hook »). Les doublons d'URL sont ignorés.
      if (!url || dejaVues.has(url)) continue
      dejaVues.add(url)
      const f = await fetchUserFile(url, 10_000_000, /^image\/(png|jpe?g|webp)$/, "une photo d'avatar (avatar_urls)")
      if (typeof f === 'string') return toolErr(f)
      avatarPoolFiles.push(f)
    }
  }
  // 420 px de large, JPEG 72 — le format qu'envoie l'app, et qui tient sous les
  // 400 Ko du chef. Renvoie null pour une vidéo ou un format non décodable :
  // le chef se rabat alors sur le NOM du média, qui reste explicite.
  const miniature = async (bytes: Uint8Array, type: string) => {
    if (!/^image\/(png|jpe?g)$/.test(type)) return null
    if (tailleImage(bytes) !== 'ok') return null   // bombe d'image : jamais décodée (le chef se rabat sur le nom)
    try {
      const Image = await loadImage()
      const img = await Image.decode(bytes)
      const w = Math.min(420, img.width)
      const petite = img.resize(w, Image.RESIZE_AUTO)
      const out = await petite.encodeJPEG(72)
      return out.length <= 380_000 ? out : null
    } catch (e) { console.warn('miniature:', (e as Error)?.message); return null }
  }
  const slug = (s: string, i: number) => (String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28)) || ('media' + i)
  const medias: { id: string; name: string; kind: 'image' | 'video'; bytes: Uint8Array; contentType: string; thumb: Uint8Array | null }[] = []
  // TOLÉRER LE JSON SÉRIALISÉ. Un client MCP passe volontiers un tableau sous
  // forme de chaîne ; avec un simple Array.isArray, tous les médias étaient
  // silencieusement ignorés — le montage sortait sans eux et sans un mot.
  let mediaArg: unknown = args.media
  if (typeof mediaArg === 'string') { try { mediaArg = JSON.parse(mediaArg) } catch (_) { mediaArg = [] } }
  if (mediaArg && !Array.isArray(mediaArg)) mediaArg = [mediaArg]
  for (const [i, m] of (Array.isArray(mediaArg) ? mediaArg : []).slice(0, 7).entries()) {
    const u = String((m as Record<string, unknown>)?.url || '').trim()
    if (!u) continue
    const nom = String((m as Record<string, unknown>)?.name || '').trim() || `media-${i + 1}`
    const f = await fetchUserFile(u, MONTAGE_MAX_BYTES, /^(image\/(png|jpe?g|webp)|video\/mp4)$/, `le média « ${nom} »`)
    if (typeof f === 'string') return toolErr(f)
    const id = slug(nom, i)
    if (id === 'avatar' || medias.some((x) => x.id === id)) continue
    medias.push({ id, name: nom, kind: /^video\//.test(f.contentType) ? 'video' : 'image', bytes: f.bytes, contentType: f.contentType,
      thumb: await miniature(f.bytes, f.contentType) })
  }
  // Audit 02/10 : durée MESURÉE (WAV / MP3 / M4A / MP4, dureeAudioMesuree). duration_seconds de l'appelant ne la remplace
  // plus (« 30 » faisait passer un audio de 20 min sous le plafond de 90 s) : il ne compte que s'il est plus LONG. Format non
  // mesurable : refusé au-delà de 3 Mo, sinon estimé sur la taille, jamais sous 16 Ko/s (un en-tête WAV forgé ne la baisse plus).
  const mesSec = dureeAudioMesuree(got.bytes)
  if (mesSec === null && got.bytes.length > MONTAGE_NON_MESURE_MAX) {
    return toolErr(`Format audio non pris en charge au-delà de ${MONTAGE_NON_MESURE_MAX / 1_000_000} Mo : sa durée ne peut pas être mesurée. Envoie un WAV, un MP3, un M4A, un FLAC, un OGG / Opus, un WebM ou un AAC. Aucun crédit débité.`)
  }
  const durAnnoncee = Number(args.duration_seconds)
  const durRaw = Math.max(
    mesSec ?? Math.max(estimateAudioSeconds(got.bytes, got.contentType), got.bytes.length / 16_000),
    Number.isFinite(durAnnoncee) && durAnnoncee > 0 ? durAnnoncee : 0)
  // format court assumé : au-delà de 90 s le montage perd son rythme (et coûte cher à rendre)
  if (durRaw > 90.5) {
    return toolErr(`Audio trop long (~${Math.round(durRaw)} s${mesSec === null ? ', estimé d\'après la taille du fichier' : ''}) : le Montage IA accepte 90 secondes maximum. Raccourcis l'audio (ou découpe-le en plusieurs vidéos courtes) puis relance.${mesSec === null ? ' Pour une durée exacte, envoie un WAV, un MP3, un M4A, un FLAC, un OGG / Opus, un WebM ou un AAC.' : ''}`)
  }
  const durEst = Math.max(5, durRaw)
  // ── LE MODÈLE DU LIPSYNC, DÉCIDÉ AVANT LE DÉBIT ─────────────────────────────
  // modèle du lipsync (23/08) : hedra (défaut) | omnihuman | mix — param OU marqueur de brief ([OMNI] / [MIX]), pour les
  // mêmes raisons de schéma en cache que [LIPSYNC] (voir plus bas). Audit 02/10 : aux droits du compte (modeleLipsyncAutorise)
  // — 'omnihuman' passait pour un Starter alors que lipsync_video le réserve à Pro / Élite ; MIX (Omni au hook + Hedra
  // ensuite) = propriétaire seul (Axel 23/08). Non autorisé ou inconnu → hedra, et la réponse le dit.
  const veutLipsync = args.lipsync === true || /\[LIPSYNC\]/i.test(brief)
  let modeleLip = String(args.lipsync_model || (/\[MIX\]/i.test(brief) ? 'mix' : /\[OMNI\]/i.test(brief) ? 'omnihuman' : 'hedra')).toLowerCase()
  let lipRepli = ''
  if (!modeleLipsyncAutorise(profile, modeleLip)) {
    console.log(`▶ lipsync : modèle ${modeleLip.slice(0, 20)} non autorisé pour ce compte → repli hedra`)
    if (veutLipsync && (modeleLip === 'omnihuman' || modeleLip === 'omni')) lipRepli = `Lipsync haute résolution réservé aux plans Pro et Élite : le visage parle en lipsync standard (${LIPSYNC_COST_SEC} crédits/s).`
    else if (veutLipsync && modeleLip === 'mix') lipRepli = `Mode mix indisponible sur ce compte : le visage parle en lipsync standard (${LIPSYNC_COST_SEC} crédits/s).`
    modeleLip = 'hedra'
  }
  // ── ON NETTOIE AVANT TOUT, TOUJOURS ─────────────────────────────────────────
  // Règle d'Axel (02/08), après un montage rendu sur une prise brute : « ajoute
  // la règle par défaut de nettoyer chaque audio avant toute chose ». Une voix
  // sale ne se rattrape pas au montage — elle passe telle quelle dans le rendu
  // final, et tout le travail visuel est jugé sur elle. Le nettoyage est donc
  // le comportement NORMAL, pas une option qu'on pense à cocher.
  // Son coût est ajouté au devis affiché avant le débit (jamais de crédit
  // silencieux), et `clean_audio: false` reste possible pour un audio déjà
  // traité — renettoyer un fichier propre ne l'améliore pas.
  const nettoyer = args.clean_audio !== false
  const coutClean = nettoyer ? coutNettoyage(got.bytes, mesSec) : 0   // durée déjà mesurée (audit 02/10)
  const cost = MONTAGE_PLAN_COST + MONTAGE_RENDER_COST + coutClean
  const userId = String(profile.id)

  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  // Audit 04/10 (MCP-3) : plafond de rendus simultanés, AVANT le devis et le débit.
  {
    const enCours = await rendusEnCours(userId)
    if (enCours === null) return toolErr('Erreur serveur — réessaie dans un instant. Aucun crédit débité.')
    if (enCours >= MAX_RENDUS_EN_COURS) return toolErr(RENDUS_EN_COURS_MSG + ' Aucun crédit débité.')
  }
  const gate = await preSpendGate(profile, ctx, args, cost,
    `Montage IA ~${Math.round(durEst)} s (style ${style})` + (nettoyer ? ` + nettoyage de la voix (${coutClean} cr)` : ''),
    'montage_ia')
  if (gate) return gate

  // Le chef d'orchestre prend ~90 s : trop long pour un appel d'outil synchrone.
  // On crée le job de suivi tout de suite et TOUT le travail part en tâche de fond
  // (waitUntil) — check_montage suit la préparation puis le rendu.
  // Relecture 02/10 : job créé à 0 puis débit RATTACHÉ au job (mcp_spend_for_job) → le remboursement partiel du nettoyage
  // et celui d'un échec rendent les crédits achetés du BON débit, de façon atomique.
  const { data: mj, error: mjErr } = await svc.from('mcp_jobs')
    .insert({ user_id: userId, kind: 'montage', status: 'running', credits_cost: 0 }).select('id').single()
  if (mjErr || !mj) { await capRelease(profile, ctx, cost); return toolErr('Erreur serveur au suivi du job — réessaie.') }
  const bal = await spendForJob(userId, mj.id, cost)
  if (bal === null || bal === -1 || bal === -2) {
    await capRelease(profile, ctx, cost)   // rien débité → part du plafond rendue (audit 28/09)
    await svc.from('mcp_jobs').update({ status: 'failed', error: 'crédits', updated_at: new Date().toISOString() }).eq('id', mj.id).eq('credits_cost', 0)
    return toolErr(bal === -1 ? `Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}` : 'Erreur crédits — réessaie.')
  }
  const mcpJob = { id: mj.id, credits_cost: cost }

  bg((async () => {
    try {
      // 0) LA VOIX, D'ABORD. Le nettoyage précède la transcription : le chef
      // d'orchestre entend alors la même chose que le spectateur, et ses
      // timings de mots sont calés sur l'audio réellement monté.
      // Échec du nettoyage (serveur de rendu ET secours ElevenLabs) : le montage continue sur
      // l'audio d'origine, les crédits du nettoyage sont rendus et credits_cost décrémenté
      // d'autant (audit métier MCP 14/09 : pas de double remboursement si le montage échoue
      // ensuite) — logique détaillée dans nettoyerAvantMontage (nettoyage-voix.ts).
      if (nettoyer) {
        await nettoyerAvantMontage({
          got, userId, coutClean, mcpJob,
          nettoyer: isolerVoix,
          // remboursement PARTIEL du nettoyage raté : atomique, une seule fois, credits_cost baissé dans la même transaction
          rembourser: async (_u, n) => { await vtRendrePartiel({ id: mcpJob.id }, n, 'nettoyage') },
          noterJob: async (maj) => { await svc.from('mcp_jobs').update({ error: maj.error }).eq('id', mcpJob.id) },
        })
      }
      // 1) chef d'orchestre — clé anon : passe le gateway, sans lire la mémoire de marque
      const ext = /wav/.test(got.contentType) ? 'wav' : /mp4|m4a|aac/.test(got.contentType) ? 'm4a' : 'mp3'
      const fd = new FormData()
      fd.append('audio', new File([got.bytes as unknown as BlobPart], 'audio.' + ext, { type: got.contentType }))
      fd.append('duration', String(Math.round(durEst * 100) / 100))
      if (script) fd.append('script', script)
      if (brief) fd.append('brief', brief)
      fd.append('options', JSON.stringify({ lang: 'fr', hasAvatar: !!avatarFile }))
      fd.append('user_id', userId)   // appel service : la mémoire de marque lue est celle de CE compte (et seulement elle)
      // le chef VOIT les médias (vision) et les place au moment que leur nom décrit
      if (medias.length) {
        fd.append('assets', JSON.stringify(medias.map((m) => ({ id: m.id, name: m.name, kind: m.kind }))))
        for (const m of medias) {
          // la MINIATURE, jamais l'original : au-delà de 400 Ko le chef ignore
          // l'image et le média ne se place nulle part
          if (m.thumb) fd.append('asset_' + m.id, new File([m.thumb as unknown as BlobPart], 'thumb.jpg', { type: 'image/jpeg' }))
          else if (m.bytes.length <= 380_000) fd.append('asset_' + m.id, new File([m.bytes as unknown as BlobPart], 'thumb', { type: m.contentType }))
        }
        console.log(`▶ médias envoyés au chef : ${medias.map((m) => m.id + (m.thumb ? '✓' : '✗')).join(', ')}`)
      }
      // Audit 02/10 : appel SERVEUR À SERVEUR avec la clé service. Depuis l'audit du 05/09, orchestrate refuse la clé
      // anon (401) → TOUS les montage_ia via Claude échouaient (nettoyage fait pour rien, puis remboursés). Le débit du
      // montage a déjà eu lieu côté MCP (mcp_debits) : la porte « débit récent » d'orchestrate ne vise que les appels client.
      const or = await fetch(`${SUPABASE_URL}/functions/v1/orchestrate`, {
        method: 'POST', headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY }, body: fd,
      })
      const od = await or.json().catch(() => ({}))
      if (!or.ok || !od.ok || !od.plan) {
        await failAndRefund(userId, mcpJob, `chef d'orchestre : ${od.error || 'HTTP ' + or.status}`)
        return
      }
      const plan = od.plan as Record<string, unknown>
      plan.duration = Math.round(durEst * 100) / 100 // le moteur recale sur la durée réelle
      if (style !== 'auto') plan.slideStyle = style
      lookProduction(plan, durEst)   // 09/10 : sous-titres, texte choc et musique de Production (comme l'app)

      // 2) l'audio devient l'entrée du rendu (le moteur gère l'absence de piste vidéo)
      const inputPath = `${userId}/mcp-montage-${Date.now()}.${ext}`
      const { error: upErr } = await svc.storage.from('render-media').upload(inputPath, got.bytes, { contentType: got.contentType })
      if (upErr) { await failAndRefund(userId, mcpJob, "upload de l'audio : " + upErr.message); return }

      // 2b) sa photo et ses médias montent au bucket : le worker les récupère
      // par la liste `assets` (id « avatar » = photo d'avatar à la racine).
      const assets: { id: string; path: string; kind: string }[] = []
      if (avatarFile) {
        const aExt = /png/.test(avatarFile.contentType) ? 'png' : /webp/.test(avatarFile.contentType) ? 'webp' : 'jpg'
        const aPath = `${userId}/mcp-avatar-${Date.now()}.${aExt}`
        const { error: aErr } = await svc.storage.from('render-media').upload(aPath, avatarFile.bytes, { contentType: avatarFile.contentType })
        if (!aErr) assets.push({ id: 'avatar', path: aPath, kind: 'image' })
        else console.warn('upload avatar:', aErr.message)
      }
      // #84 · les visages du pool → assets avatar-1, avatar-2… (rotation worker)
      for (const [pi, pf] of avatarPoolFiles.entries()) {
        const pExt = /png/.test(pf.contentType) ? 'png' : /webp/.test(pf.contentType) ? 'webp' : 'jpg'
        const pPath = `${userId}/mcp-avatar-${pi + 1}-${Date.now()}.${pExt}`
        const { error: pErr } = await svc.storage.from('render-media').upload(pPath, pf.bytes, { contentType: pf.contentType })
        if (!pErr) assets.push({ id: 'avatar-' + (pi + 1), path: pPath, kind: 'image' })
        else console.warn('upload avatar pool ' + (pi + 1) + ':', pErr.message)
      }
      for (const m of medias) {
        const mExt = m.kind === 'video' ? 'mp4' : /png/.test(m.contentType) ? 'png' : /webp/.test(m.contentType) ? 'webp' : 'jpg'
        const mPath = `${userId}/mcp-as-${m.id}-${Date.now()}.${mExt}`
        const { error: mErr } = await svc.storage.from('render-media').upload(mPath, m.bytes, { contentType: m.contentType })
        if (!mErr) assets.push({ id: m.id, path: mPath, kind: m.kind })
        else console.warn('upload média ' + m.id + ':', mErr.message)
      }

      // ── #42 · LE VISAGE PARLE, SI ON LE DEMANDE ────────────────────────────
      // Axel : « faut qu'il appelle l'API Hedra et qu'il génère scène par scène,
      // pas tout l'audio » — et, pour ses propres tests : « continue à m'envoyer
      // juste une image, et quand je te dis passe au lipsync tu peux ». D'où le
      // défaut à false : itérer sur un montage ne doit pas brûler des crédits de
      // lipsync à chaque essai. Le drapeau voyage dans le plan ; c'est le worker
      // qui découpe et appelle Hedra, parce que lui seul a ffmpeg.
      // ⚠ ET AUSSI DEPUIS LE BRIEF. Mesuré : le premier essai n'a jamais activé le
      // lipsync parce que le client MCP avait en cache le schéma d'AVANT l'ajout
      // du paramètre — il l'a donc retiré de l'appel avant de l'envoyer, en
      // silence. Un marqueur dans le brief passe partout, quel que soit l'âge du
      // schéma côté client. Ceinture et bretelles, pour une option qui coûte des
      // crédits : mieux vaut deux chemins qu'un qui échoue sans le dire.
      // (veutLipsync et modeleLip : décidés avant le débit, aux droits du compte — audit 02/10)
      if (veutLipsync) (plan as Record<string, unknown>).__lipsync = true
      if (veutLipsync && modeleLip !== 'hedra') { (plan as Record<string, unknown>).lipsyncModel = modeleLip; console.log(`▶ lipsync : modèle ${modeleLip}`) }
      console.log(`▶ lipsync demandé : ${veutLipsync} (param ${args.lipsync}, brief ${/\[LIPSYNC\]/i.test(brief)})`)

      // ── SOUS-TITRES HOOK UNIQUEMENT (Axel 12/08 : « garde ceux du hook juste ») ─
      // Même mécanique que le lipsync : un marqueur [SUBSHOOK] dans le brief pose
      // le drapeau sur le plan, le moteur (dynamic-engine) ne garde alors que les
      // groupes de sous-titres qui tombent dans le hook — le reste de la vidéo se
      // lit par les visuels. Opt-in : sans le marqueur, rien ne change pour personne.
      if (/\[SUBSHOOK\]/i.test(brief)) {
        (plan as Record<string, unknown>).subtitlesHookOnly = true
        console.log('▶ sous-titres : hook uniquement (marqueur [SUBSHOOK])')
      }

      // 3) job de rendu, puis lien op_name → le job devient suivable de bout en bout
      // audit 02/10 (WRK-1) : chemins revalidés comme ceux d'un client avant d'entrer dans render_jobs (défense en profondeur)
      if (cheminSur(userId, inputPath) !== inputPath || assets.some((a) => cheminSur(userId, a.path) !== a.path)) {
        await failAndRefund(userId, mcpJob, 'chemin de stockage invalide'); return
      }
      // Audit 04/10 (MCP-3) : revérifié à l'insertion (d'autres rendus ont pu partir pendant la préparation, ~2 min) —
      // plafond atteint → montage clos et crédits rendus (failAndRefund), comme render-job côté app.
      const enCours = await rendusEnCours(userId, false)
      if (enCours === null || enCours >= MAX_RENDUS_EN_COURS) {
        await failAndRefund(userId, mcpJob, enCours === null ? 'création du job de rendu impossible' : RENDUS_EN_COURS_MSG); return
      }
      const { data: rj, error: rjErr } = await svc.from('render_jobs')
        .insert({ user_id: userId, status: 'queued', plan, input_video: inputPath, assets })
        .select('id').single()
      if (rjErr || !rj) { await failAndRefund(userId, mcpJob, 'création du job de rendu impossible'); return }
      await svc.from('mcp_jobs').update({ op_name: String(rj.id), updated_at: new Date().toISOString() }).eq('id', mj.id)
    } catch (e) {
      await failAndRefund(userId, mcpJob, String((e as Error)?.message || e).slice(0, 200))
    }
  })())

  return toolText(
    `Montage IA lancé (~${Math.round(durEst)} s, style ${style}, −${cost} crédits)
job_id : ${mj.id}
Le chef d'orchestre transcrit et prépare le plan (~2 min), puis le moteur rend le MP4.
Appelle check_montage avec ce job_id dans environ 2 minutes.
${nettoyer
  ? `La voix est nettoyée avant le montage (bruit de fond, souffle, clics — −${coutClean} cr sur le total). Si ton audio est DÉJÀ traité, passe clean_audio: false — le renettoyer ne l'améliore pas.`
  : `Attention : audio monté TEL QUEL, à ta demande (clean_audio: false). Si le rendu sonne sale, relance sans ce paramètre.`}${lipRepli ? '\n' + lipRepli : ''}
Une fois prêt : get_montage_plan → ajuste le plan → render_montage_plan pour une variante.`)
}

async function runCheckMontage(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const userId = String(profile.id)
  const { data: job } = await svc.from('mcp_jobs').select('*')
    .eq('id', jobId).eq('user_id', userId).eq('kind', 'montage').maybeSingle()
  if (!job) return toolErr('Job montage introuvable sur ce compte.')
  // AJUSTER SANS REPASSER PAR MOI. Une fois la vidéo sortie, la vraie question
  // suivante est « et si je change cette animation ? ». Le lien ouvre l'écran
  // « Détails du montage » directement sur ce job — c'est plus juste que de lui
  // décrire le plan.
  if (job.status === 'done') {
    const lien = job.op_name ? `\nPour ajuster une scène, une transition ou un bruitage : ${lienDetails(String(job.op_name))}` : ''
    { const dl = `https://mcp.avatarads.fr/i/${job.id}`; return toolMedia(dl, 'montage.mp4', 'video/mp4', `✅ Montage prêt !\nLien : ${dl}${lien}`, String(job.preview_url || '') || undefined) }
  }
  if (job.status === 'failed') return toolErr(`Rendu échoué : ${erreurClient(job.error)} (crédits remboursés).`)

  // phase 1 (op_name vide) : le chef d'orchestre prépare encore le plan en tâche de fond
  if (!job.op_name) {
    if (Date.now() - new Date(job.created_at).getTime() > 20 * 60_000) {
      await failAndRefund(userId, job, 'préparation du plan bloquée')
      return toolErr('La préparation du plan est restée bloquée — crédits remboursés, relance montage_ia.')
    }
    return toolText('🧠 Le chef d\'orchestre transcrit et prépare le plan de montage — rappelle check_montage dans ~1 minute.')
  }

  const { data: rj } = await svc.from('render_jobs')
    .select('status, output_url, error, created_at').eq('id', job.op_name).maybeSingle()
  if (!rj) {
    await failAndRefund(userId, job, 'job de rendu disparu')
    return toolErr('Job de rendu introuvable — crédits remboursés.')
  }
  if (rj.status === 'failed') {
    await failAndRefund(userId, job, rj.error || 'échec du rendu')
    return toolErr(`Rendu échoué : ${erreurClient(rj.error)} — crédits remboursés.`)
  }
  if (rj.status === 'queued') {
    // moteur de rendu hors ligne ? au-delà de 2 h en file → annulation + remboursement
    if (Date.now() - new Date(rj.created_at).getTime() > 2 * 3600_000) {
      await svc.from('render_jobs').update({ status: 'failed', error: 'moteur de rendu hors ligne' })
        .eq('id', job.op_name).eq('status', 'queued')
      await failAndRefund(userId, job, 'moteur de rendu hors ligne')
      return toolErr('Le moteur de rendu est resté hors ligne plus de 2 h — crédits remboursés, réessaie plus tard.')
    }
    return enCours("En file d'attente du moteur de rendu.", 'check_montage', '1 minute')
  }
  if (rj.status === 'rendering') return enCours('Rendu du montage en cours (il prend 2 à 5 minutes).', 'check_montage', '1 minute')
  if (rj.status === 'done' && rj.output_url) {
    // ré-héberge le MP4 en public (render-media est privé) — claim atomique anti-doublon
    const dl = await svc.storage.from('render-media').download(String(rj.output_url))
    if (dl.error || !dl.data) return toolText('⏳ Presque prêt — rappelle check_montage dans quelques secondes.')
    const bytes = new Uint8Array(await dl.data.arrayBuffer())
    const url = await deliverVideo(userId, job, bytes)
    // Le POSTER fabriqué par le worker (convention : `<clé>.poster.jpg`, cf.
    // worker.mjs). Ré-hébergé en public et mémorisé dans preview_url : le
    // premier check l'affiche, les relectures le retrouvent. Best-effort —
    // pas de poster (vieux rendu, worker pas encore à jour) = pas de vignette,
    // jamais un échec.
    let apercu: string | undefined
    if (url) {
      try {
        const dp = await svc.storage.from('render-media').download(String(rj.output_url) + '.poster.jpg')
        if (!dp.error && dp.data) {
          apercu = await uploadMedia(userId, new Uint8Array(await dp.data.arrayBuffer()), 'jpg', 'image/jpeg')
          await svc.from('mcp_jobs').update({ preview_url: apercu }).eq('id', job.id)
        }
      } catch { /* vignette best-effort */ }
    }
    return url
      ? toolMedia(url, 'montage.mp4', 'video/mp4', `✅ Montage prêt !\nURL : ${url}\n💡 Pour ajuster : get_montage_plan → modifie → render_montage_plan. Ou ouvre l'Éditeur sur ${APP_URL}`, apercu)
      : toolText('⏳ Presque prêt — rappelle check_montage dans quelques secondes.')
  }
  return toolText(`⏳ Statut : ${rj.status} — rappelle check_montage dans ~1 minute.`)
}

// ── RENVOYER L'ÉCRAN, PAS SA DESCRIPTION ────────────────────────────────────
// Relire un montage scène par scène dans une réponse d'outil, c'est demander à
// quelqu'un de se représenter un montage en lisant un tableau. L'app a déjà
// l'écran qu'il faut — la bande, les aperçus animés, le swipe, la
// régénération. On renvoie donc un LIEN qui l'ouvre sur le bon job.
// APP_URL vaut déjà « https://avatarads.fr/app/ » — pas de segment à rajouter.
const lienDetails = (renderJobId: string) => `${APP_URL.replace(/\/+$/, '')}/#montage=${renderJobId}`

async function runGetMontagePlan(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  const { data: job } = await svc.from('mcp_jobs').select('op_name')
    .eq('id', jobId).eq('user_id', String(profile.id)).eq('kind', 'montage').maybeSingle()
  if (!job) return toolErr('Job montage introuvable sur ce compte.')
  const { data: rj } = await svc.from('render_jobs').select('plan').eq('id', job.op_name).maybeSingle()
  if (!rj?.plan) return toolErr('Plan introuvable pour ce job.')
  return toolText(
    `Détails du montage — ouvre l'écran d'AvatarAds sur ce montage :\n${lienDetails(String(job.op_name))}\n\n` +
    `(Donne ce lien tel quel à l'utilisateur : il y retrouve la bande, les aperçus d'animations, le remplacement au swipe et la régénération.)\n\n` +
    `Plan de montage du job ${jobId} en JSON, si tu préfères le retoucher ici puis appeler render_montage_plan :\n${JSON.stringify(rj.plan)}`)
}

async function runRenderMontagePlan(profile: Record<string, unknown>, args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolContent> {
  const jobId = String(args.job_id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolErr('job_id invalide.')
  let plan: unknown = args.plan
  if (typeof plan === 'string') { try { plan = JSON.parse(plan) } catch { return toolErr('plan : JSON invalide.') } }
  if (!plan || typeof plan !== 'object' || !Number((plan as Record<string, unknown>).duration)) {
    return toolErr('plan invalide (champ duration manquant) — repars du JSON de get_montage_plan.')
  }
  if (Number((plan as Record<string, unknown>).duration) > 300) return toolErr('plan trop long (max 5 min).')
  // audit 02/10 (WRK-4) : mêmes bornes que render-job (512 Ko, tableaux) — un plan démesuré n'entre pas dans la file
  { const refus = controlerTaillePlan(plan); if (refus) return toolErr(refus.status === 413 ? 'Plan trop volumineux — repars du JSON de get_montage_plan.' : 'Plan invalide — repars du JSON de get_montage_plan.') }

  const userId = String(profile.id)
  const { data: src } = await svc.from('mcp_jobs').select('op_name')
    .eq('id', jobId).eq('user_id', userId).eq('kind', 'montage').maybeSingle()
  if (!src) return toolErr("Job montage d'origine introuvable sur ce compte.")
  const { data: srcRj } = await svc.from('render_jobs').select('input_video, assets, plan')
    .eq('id', src.op_name).maybeSingle()
  if (!srcRj?.input_video) return toolErr("Audio du montage d'origine introuvable.")
  // audit 02/10 (WRK-1) : la source et les médias réutilisés restent dans le dossier du compte (motif fermé)
  const srcInput = cheminSur(userId, srcRj.input_video)
  if (!srcInput) return toolErr("Audio du montage d'origine introuvable.")
  const srcAssets = (Array.isArray(srcRj.assets) ? srcRj.assets : [])
    .filter((a: Record<string, unknown>) => a && cheminSur(userId, a.path) === a.path)
  // Audit 02/10 : le plan vient de l'appelant → AUCUNE clé interne du moteur n'est acceptée de lui (__batchBlank régénérait
  // les aperçus publics, __compose doublait la file, etc.). Les seules clés internes utiles (__lipsync, __brief) sont
  // reprises du plan D'ORIGINE ; un son utilisateur n'est accepté que dans le dossier du compte.
  {
    const pl = plan as Record<string, unknown>, orig = ((srcRj.plan || {}) as Record<string, unknown>)
    const gardeLip = pl.__lipsync !== undefined && pl.__lipsync !== false   // l'appelant peut RETIRER le lipsync, jamais l'ajouter
    for (const k of Object.keys(pl)) if (k.startsWith('__')) delete pl[k]
    if (gardeLip && orig.__lipsync !== undefined) pl.__lipsync = orig.__lipsync
    if (orig.__brief !== undefined) pl.__brief = orig.__brief
    // son utilisateur : userAudioPath dans le dossier du compte (motif fermé, audit 02/10), userAudio (fichier local du worker)
    // jamais de l'appelant, userAudioVol borné (interpolé dans un filtre ffmpeg)
    nettoyerSonUtilisateur(userId, pl)
    const d = Number(pl.duration); if (Number.isFinite(d)) pl.duration = d
    // Audit 02/10 : modèle du lipsync aux droits du compte (modeleLipsyncAutorise), celui du plan ET les surcharges par fenêtre
    // (avatarSegments[].lipsyncModel, qu'aucun écran ne pose) : 'omnihuman' passait pour un Starter, 'mix' pour tous. Non
    // autorisé → retiré (le moteur prend hedra, le défaut ; il revérifie aussi les droits du compte du job).
    if (pl.lipsyncModel !== undefined && !modeleLipsyncAutorise(profile, pl.lipsyncModel)) delete pl.lipsyncModel
    if (Array.isArray(pl.avatarSegments)) {
      for (const w of pl.avatarSegments as unknown[]) {
        const f = w as Record<string, unknown> | null
        if (f && typeof f === 'object' && f.lipsyncModel !== undefined && !modeleLipsyncAutorise(profile, f.lipsyncModel)) delete f.lipsyncModel
      }
    }
  }

  const cost = MONTAGE_RENDER_COST
  if (!isUnlimited(profile) && (Number(profile.credits_remaining) || 0) < cost) {
    return toolErr(`Crédits insuffisants : il faut ${cost} crédits, il en reste ${profile.credits_remaining ?? 0}. Recharge sur ${APP_URL}`)
  }
  // Audit 04/10 (MCP-3) : plafond de rendus simultanés, AVANT le devis et le débit (revérifié dans createMontageJobs).
  {
    const enCours = await rendusEnCours(userId)
    if (enCours === null) return toolErr('Erreur serveur — réessaie dans un instant. Aucun crédit débité.')
    if (enCours >= MAX_RENDUS_EN_COURS) return toolErr(RENDUS_EN_COURS_MSG + ' Aucun crédit débité.')
  }
  const gate = await preSpendGate(profile, ctx, args, cost, 'nouveau rendu du plan modifié', 'render_montage_plan')
  if (gate) return gate
  const bal = await spendCredits(userId, cost)
  if (bal === null || bal === -1) await capRelease(profile, ctx, cost)   // rien débité → part du plafond rendue (audit 28/09)
  if (bal === null) return toolErr('Erreur crédits — réessaie.')
  if (bal === -1) return toolErr(`Crédits insuffisants : il faut ${cost} crédits. Recharge sur ${APP_URL}`)

  let launched = false
  try {
    const made = await createMontageJobs(userId, plan as Record<string, unknown>, srcInput, srcAssets, cost)
    if (typeof made === 'string') return toolErr(made)
    launched = true
    return toolText(
      `🎬 Nouveau rendu lancé avec le plan modifié ! (−${cost} crédits)
job_id : ${made.jobId}
Appelle check_montage avec ce job_id dans 1 à 2 minutes.`)
  } finally {
    if (!launched) await refundCredits(userId, cost)
  }
}

async function runListMedia(profile: Record<string, unknown>): Promise<ToolContent> {
  const userId = String(profile.id)
  const { data: brut, error } = await svc.storage.from('mcp-media')
    .list(userId, { limit: 24, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) { console.warn('[mcp] list_media', error.message); return toolErr('Lecture des médias impossible pour le moment — réessaie.') }   // audit 02/10 : jamais le message brut du stockage
  const data = (brut || []).filter((f) => !!f.id)   // les sous-dossiers (id null) n'ont pas de lien utile
  if (!data.length) return toolText('Aucun média généré via Claude pour le moment.')
  const signes = new Map<string, string>()   // mcp-media privé (audit 28/09) : liens signés 7 jours, en un seul appel
  try { const { data: sg } = await svc.storage.from('mcp-media').createSignedUrls(data.map((f) => `${userId}/${f.name}`), 7 * 86400); for (const x of sg || []) if (x.signedUrl && x.path) signes.set(x.path, x.signedUrl) } catch { /* liste sans liens */ }
  const urlDe = (n: string) => signes.get(`${userId}/${n}`) || `${MEDIA_PUB}${userId}/${n}`
  const lines = data.map((f) =>
    `- ${f.name} (${f.created_at ? new Date(f.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—'}) : ${urlDe(f.name)}`)
  // GALERIE (réf. intégrations concurrentes) : les dernières images s'affichent
  // directement dans la carte, pas seulement en liste de liens. On préfère les
  // aperçus .jpg (déjà réduits) et on plafonne à 5 pour rester léger.
  const contenu: Array<Record<string, unknown>> = []
  const images = data.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name))
  // un PNG et son aperçu JPG naissent à ~1 s d'écart avec deux timestamps :
  // on groupe par tranche de 5 s et on garde UN visuel par génération (le JPG
  // — déjà réduit — de préférence)
  const parGen = new Map<number, { name: string; jpg: boolean }>()
  for (const f of images) {
    const ts = Number((f.name.match(/^(\d{10,})/) || [])[1] || 0)
    const cle = ts ? Math.round(ts / 5000) : Math.random()
    const jpg = /\.jpe?g$/i.test(f.name)
    const ex = parGen.get(cle)
    if (!ex || (jpg && !ex.jpg)) parGen.set(cle, { name: f.name, jpg })
  }
  let n = 0
  for (const { name } of parGen.values()) {
    if (n >= 5) break
    const bloc = await blocImage(urlDe(name))
    if (bloc) { contenu.push(bloc); n++ }
  }
  contenu.push({ type: 'text', text: `Derniers médias générés (les ${n} images les plus récentes sont affichées ci-dessus) :\n${lines.join('\n')}` })
  return { content: contenu }
}

// ── #37 · LE BACKLOG DE LA BANQUE D'ANIMATIONS ────────────────────────────
// Idée d'Axel : plutôt que de deviner quelles animations écrire, on laisse les
// vrais montages nous le dire. À chaque fois que le rattrapage du chef
// d'orchestre répond « rien dans la banque ne montre ça », la demande est
// enregistrée avec le mot, la phrase et le nom qu'il proposerait.
// Ici on la lit, classée par fréquence : c'est l'ordre dans lequel fabriquer.
async function runAnimationsDemandees(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  if (profile.is_owner !== true) return toolErr('Outil réservé au compte administrateur.')   // audit 02/10 : propriétaire seul (plus le plan developer)
  const limite = Math.max(1, Math.min(60, Number(args.limite) || 20))
  const jours = Number(args.depuis_jours) || 0
  let q = svc.from('anim_demandes_top').select('*').limit(limite)
  if (jours > 0) q = q.gte('derniere', new Date(Date.now() - jours * 86400000).toISOString())
  const { data, error } = await q
  if (error) { console.warn('[mcp] list_media', error.message); return toolErr('Lecture impossible pour le moment — réessaie.') }
  if (!data || !data.length) {
    return toolText("Aucune animation manquante enregistrée pour l'instant.\n(Chaque montage qui rencontre un mot que la banque ne sait pas dessiner en ajoute une.)")
  }
  const tot = data.reduce((n: number, r: Record<string, unknown>) => n + Number(r.demandes || 0), 0)
  const lignes = data.map((r: Record<string, unknown>, i: number) => {
    const d = Number(r.demandes || 0), u = Number(r.utilisateurs || 0)
    return `${String(i + 1).padStart(2)}. « ${r.mot} » — ${d} demande${d > 1 ? 's' : ''}`
      + `${u > 1 ? ` · ${u} utilisateurs` : ''}`
      + `${r.nom_propose ? ` · nom proposé : \`${r.nom_propose}\`` : ''}`
      + `${r.montre ? `\n      montre : ${r.montre}` : ''}`
      + `${r.exemple ? `\n      entendu : « ${String(r.exemple).slice(0, 90)} »` : ''}`
  }).join('\n')
  return toolText(
    `Animations manquantes — ${data.length} mot(s), ${tot} demande(s) au total${jours ? ` sur ${jours} jours` : ''}\n\n${lignes}\n\n`
    + `Les trois premières sont celles à fabriquer en priorité : elles reviennent le plus souvent dans de vrais montages.`,
  )
}

async function runAdminFindUser(profile: Record<string, unknown>, args: Record<string, unknown>): Promise<ToolContent> {
  if (profile.is_owner !== true) return toolErr('Outil réservé au compte administrateur.')   // audit 02/10 : propriétaire seul (plus le plan developer)
  const email = String(args.email || '').trim().toLowerCase()
  if (!email) return toolErr('Le paramètre "email" est requis.')
  const { data: u } = await svc.from('profiles').select(
    'id, email, first_name, plan, credits_remaining, bought_credits, videos_used, images_used, quota_reset_date, referred_by, whop_member_id, whop_cancel_at_period_end, email_optout, created_at',
  ).eq('email', email).maybeSingle()
  if (!u) return toolText(`Aucun compte avec l'e-mail ${email}.`)
  const { data: logs } = await svc.from('email_log').select('kind, sent_at')
    .eq('email', email).order('sent_at', { ascending: false }).limit(5)
  const logTxt = (logs && logs.length)
    ? logs.map((l) => `  - ${l.kind} · ${new Date(l.sent_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`).join('\n')
    : '  (aucun)'
  return toolText(
    `Fiche utilisateur ${u.email}
- Prénom : ${u.first_name || '—'} · inscrit le ${new Date(u.created_at).toLocaleDateString('fr-FR')}
- Plan : ${u.plan || 'free'} · crédits : ${u.credits_remaining ?? 0} (dont achetés : ${u.bought_credits ?? 0})
- Vidéos utilisées ce mois : ${u.videos_used ?? 0} · images : ${u.images_used ?? 0} (reset : ${u.quota_reset_date || '—'})
- Parrainé par : ${u.referred_by || '—'} · Whop : ${u.whop_member_id || '—'}${u.whop_cancel_at_period_end ? ' (annulation en fin de période)' : ''}
- E-mails marketing : ${u.email_optout ? 'désinscrit' : 'inscrit'}
- Derniers e-mails envoyés :
${logTxt}`)
}

// ═══ OAUTH (RFC 8414 / 7591 / 7636) — le connecteur « Se connecter avec ═══
// AvatarAds » (15/08). Pourquoi : Bloom et Alexya rendent leurs widgets
// interactifs dans claude.ai en connecteurs persos, et leur seul différentiel
// structurel est l'OAuth — hypothèse : le rendu des iframes est réservé aux
// connecteurs authentifiés. Bonus immédiat : plus de clé à coller, et la
// régénération de clé ne casse plus rien.
// Le flux : claude.ai reçoit un 401 sur l'URL nue → lit les .well-known →
// s'enregistre (/register) → envoie l'utilisateur sur /authorize → on redirige
// vers l'app (déjà connectée) qui demande le consentement → l'app appelle
// /oauth/approve avec le JWT → code → claude.ai l'échange sur /token (PKCE)
// → jeton Bearer aat_… accepté par la porte MCP comme une clé.
const OAUTH_BASE = 'https://mcp.avatarads.fr'
// Domaines par lesquels on accepte de se faire appeler comme serveur MCP. Le
// domaine OAuth SUIT celui de connexion : claude.ai exige que la métadonnée
// (resource / issuer / endpoints) soit sur le MÊME host que le connecteur —
// sinon « autorisation impossible ». Netlify (proxy) transmet le host d'origine
// en `x-forwarded-host`. Host inconnu → repli sur le netlify (comportement
// actuel, aucune régression). Renommer = ajouter le domaine ici + DNS + Netlify.
const OAUTH_HOSTS = ['avatarads-mcp.netlify.app', 'mcp.avatarads.fr', 'avatarads-mcp.fr']
function oauthBase(req: Request): string {
  // Supabase (Deno Deploy) STRIPPE `x-forwarded-host` — mesuré le 15/08. La
  // fonction edge Netlify pose donc AUSSI `x-mcp-connect-host` (custom → survit) ;
  // on le lit en priorité, avec repli sur x-forwarded-host puis host.
  const fwd = (req.headers.get('x-mcp-connect-host') || req.headers.get('x-forwarded-host') || req.headers.get('host') || '')
    .split(',')[0].trim().toLowerCase()
  return OAUTH_HOSTS.includes(fwd) ? 'https://' + fwd : OAUTH_BASE
}
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000       // 30 jours (plafonné à la fin de la famille)
const CODE_TTL_MS = 10 * 60 * 1000
// Audit 02/10 : refresh en FAMILLES (migration 20261003070000) — fin absolue 90 jours après la première émission,
// réutilisation d'un refresh déjà tourné = famille révoquée, sauf dans les 60 s (rafraîchissements simultanés).
const FAMILY_TTL_MS = 90 * 24 * 3600 * 1000
const REFRESH_GRACE_S = 60
const OLD_ACCESS_S = 10 * 60                     // rotation douce : l'ancien accès vit encore 10 min au plus
// Audit 02/10 : bornes de /register et format PKCE (RFC 7636 : base64url sans remplissage, 43 à 128 caractères)
const MAX_REDIRECT_URIS = 10, MAX_URI_LEN = 2048, MAX_CLIENT_NAME = 120
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/
const OAUTH_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Audit 02/10 : identité « Claude » décidée CÔTÉ SERVEUR sur des listes EXACTES, relevées en prod le 03/10
// (mcp_oauth_clients.cimd_url / redirect_uris) et confirmées par les documents CIMD publiés par claude.ai.
// Ajouter une valeur ici seulement après l'avoir observée chez un vrai client Anthropic.
const CLAUDE_CIMD: Record<string, string> = {
  'https://claude.ai/oauth/mcp-oauth-client-metadata': 'Claude',
  'https://claude.ai/oauth/claude-code-client-metadata': 'Claude Code',
}
const CLAUDE_REDIRECTS = ['https://claude.ai/api/mcp/auth_callback']
// Hôtes Anthropic : réservés au flux CIMD officiel (aucun client /register ni CIMD tiers ne peut y renvoyer le code).
const hoteAnthropic = (h: string) => /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/i.test(String(h || '').replace(/\.+$/, ''))
const hoteUriAnthropic = (uri: string) => { try { return hoteAnthropic(new URL(uri).hostname) } catch { return true } }
// Nom affichable : sans caractères de contrôle ni d'inversion de sens (usurpation visuelle), 120 caractères au plus.
const nomClientPropre = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, MAX_CLIENT_NAME)

const hexAleatoire = (n: number) => {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function sha256b64url(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
}

const DOC_AS = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/authorize`,
  token_endpoint: `${base}/token`,
  registration_endpoint: `${base}/register`,
  // Audit 04/10 (MCP-1) : révocation RFC 7009 (« Déconnecter » côté client). NB : mcp.avatarads.fr sert ses propres
  // métadonnées statiques (mcp-proxy/.well-known) — l'y ajouter pour que claude.ai l'utilise.
  revocation_endpoint: `${base}/revoke`,
  revocation_endpoint_auth_methods_supported: ['none'],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['avatarads'],
  // CIMD (draft-ietf-oauth-client-id-metadata-document) : le nouvel écran
  // claude.ai (08/2026) propose « métadonnées client hébergées par Anthropic —
  // Recommandé » ; il ne choisit CIMD QUE si ce flag est true ET que
  // token_endpoint_auth_methods_supported contient 'none' (doc Anthropic).
  client_id_metadata_document_supported: true,
})

// ═══ CIMD — Client ID Metadata Documents (29/08) ═════════════════════════════
// Nouveau flux claude.ai : client_id = URL https d'un document JSON de
// métadonnées (ex. https://claude.ai/oauth/claude-code-client-metadata :
// { client_id: <l'URL>, client_name, redirect_uris: [...] }). Pas de /register.
// On mappe chaque URL sur un uuid interne (mcp_oauth_clients.cimd_url unique)
// pour que codes/tokens (colonnes client_id uuid) restent INCHANGÉS.
const isCimdClientId = (s: string) => /^https:\/\/\S+$/.test(s)
// redirection loopback (RFC 8252 §7.3) : Claude Code déclare
// http://localhost/callback et http://127.0.0.1/callback puis utilise un PORT
// éphémère → le port ne compte pas dans la comparaison.
function loopbackUrl(uri: string): URL | null {
  try {
    const v = new URL(uri)
    return (v.protocol === 'http:' && (v.hostname === 'localhost' || v.hostname === '127.0.0.1')) ? v : null
  } catch { return null }
}
function redirectUriAllowed(uri: string, allowed: string[]): boolean {
  if (allowed.includes(uri)) return true
  const v = loopbackUrl(uri)
  if (!v) return false
  return allowed.some((a) => {
    const w = loopbackUrl(a)
    return !!w && w.hostname === v.hostname && w.pathname === v.pathname
  })
}
// Récupère + valide le document, upsert la ligne client, rend l'uuid interne.
// Garde-fous : https only, pas d'IP/localhost/.local/.internal (anti-SSRF),
// 5 s max, 100 Ko max, doc.client_id DOIT être l'URL exacte (exigence du draft).
async function resolveCimdClient(clientIdUrl: string): Promise<{ id: string, uris: string[] } | null> {
  let u: URL
  try { u = new URL(clientIdUrl) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null   // audit 02/10 : port refusé, comme fetchTO
  const h = u.hostname.toLowerCase()
  if (isBlockedHost(h)) return null   // M1 (06/09) : filtre anti-SSRF PARTAGÉ (bloque décimal/octal/hex, IPv6, plages privées, métadonnées)
  // ── CACHE CIMD (31/08) : si ce client est DÉJÀ enregistré, on réutilise ses redirect_uris SANS
  // le fetch externe (vers l'URL de Claude). Ce fetch, dans le chemin bloquant de /authorize,
  // ajoutait une latence variable qui — combinée au cold start — faisait timeouter Claude
  // (« Impossible de joindre AvatarAds »). L'URL CIMD de Claude est STABLE et a été validée au 1er
  // enregistrement → on ne re-fetche QUE si le client est inconnu. /authorize devient rapide+fiable.
  try {
    const { data: hit } = await svc.from('mcp_oauth_clients')
      .select('client_id, redirect_uris').eq('cimd_url', clientIdUrl).maybeSingle()
    if (hit && Array.isArray(hit.redirect_uris) && hit.redirect_uris.length) {
      return { id: String(hit.client_id), uris: hit.redirect_uris as string[] }
    }
  } catch (_) { /* pas de cache → on fetche normalement ci-dessous */ }
  if (await hostResolvesInternal(u.hostname)) return null   // round3 : DNS pointant en interne/métadonnées
  // Audit 28/09 (basse) : /authorize créait un client OAuth par URL CIMD inconnue, sans le plafond de /register (30 / h par IP)
  // → 20 NOUVEAUX documents CIMD par heure et par hôte (les clients déjà connus, dont Claude, passent par le cache ci-dessus).
  if (!(await rateHit('mcp-cimd:' + h, 3600, 20))) return null
  // Audit 02/10 : plafond GLOBAL en plus du plafond par hôte (des milliers de sous-domaines jetables = autant de
  // plafonds de 20). Les 2 clients CIMD réels (claude.ai) passent par le cache ci-dessus et n'y sont jamais comptés.
  if (!(await rateHit('mcp-cimd:global', 3600, 60))) return null
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 5000)
  // deno-lint-ignore no-explicit-any
  let doc: any = null
  try {
    const r = await fetch(clientIdUrl, { signal: ctl.signal, redirect: 'error', headers: { Accept: 'application/json' } })
    if (r.ok) {
      // audit 02/10 : lecture BORNÉE à 100 Ko (avant : tout le corps lu, puis mesuré)
      const b = await lireCorpsBorne(r, 100_000, 5000)
      if (b instanceof Uint8Array) doc = JSON.parse(new TextDecoder().decode(b))
    }
  } catch { doc = null } finally { clearTimeout(t) }
  if (!doc || typeof doc !== 'object') return null
  if (String(doc.client_id || '') !== clientIdUrl) return null
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.map(String).slice(0, 16) : []
  if (!uris.length || uris.some((x: string) => x.length > MAX_URI_LEN || (!/^https:\/\//.test(x) && !loopbackUrl(x)))) return null
  // Audit 02/10 : un document CIMD hébergé HORS d'un domaine Anthropic ne peut pas déclarer un retour claude.ai /
  // claude.com / anthropic.com (il passerait pour « Claude » sur la page de consentement).
  if (!hoteAnthropic(h) && uris.some((x: string) => hoteUriAnthropic(x))) return null
  const { data: row, error } = await svc.from('mcp_oauth_clients')
    .upsert({ cimd_url: clientIdUrl, client_name: nomClientPropre(doc.client_name || u.hostname) || u.hostname, redirect_uris: uris },
      { onConflict: 'cimd_url' })
    .select('client_id').single()
  if (error || !row) return null
  return { id: String(row.client_id), uris }
}

// Audit 02/10 (contrat C2) : identité affichée sur la page de consentement. trusted = document CIMD officiel de
// claude.ai, ou retour EXACT sur le callback claude.ai (client /register historique de claude.ai) ; le redirect_uri
// doit déjà avoir été validé contre le client. Jamais d'expression régulière sur le domaine ici.
function identiteClient(c: { cimd_url?: unknown, client_name?: unknown }, redirectUri: string): { name: string, host: string, trusted: boolean } {
  const cimd = String(c.cimd_url || '')
  const officiel = Object.prototype.hasOwnProperty.call(CLAUDE_CIMD, cimd)
  const trusted = officiel || CLAUDE_REDIRECTS.includes(redirectUri)
  let host = ''
  try { host = new URL(redirectUri).host } catch { host = '' }
  const name = trusted ? (officiel ? CLAUDE_CIMD[cimd] : 'Claude') : (nomClientPropre(c.client_name) || host)
  return { name, host, trusted }
}
// Audit 02/10 : client_id reçu par /token → uuid interne d'un client EXISTANT (URL CIMD résolue SANS fetch : le client
// existe depuis /authorize). null = client inconnu.
async function clientUuidDe(clientId: string): Promise<string | null> {
  if (!clientId) return null
  const cimd = isCimdClientId(clientId)
  if (!cimd && !OAUTH_UUID_RE.test(clientId)) return null
  const { data } = await svc.from('mcp_oauth_clients').select('client_id')
    .eq(cimd ? 'cimd_url' : 'client_id', clientId).maybeSingle()
  return data ? String(data.client_id).toLowerCase() : null
}

// Toutes les routes OAuth ; renvoie null si la requête n'en est pas une.
async function handleOAuth(req: Request, url: URL, segs: string[]): Promise<Response | null> {
  const p1 = segs[1] || ''

  // ── découverte ──
  if (p1 === '.well-known') {
    const doc = segs[2] || ''
    const base = oauthBase(req)
    if (doc === 'oauth-protected-resource') {
      return json(200, { resource: base, authorization_servers: [base],
        scopes_supported: ['avatarads'], bearer_methods_supported: ['header'] })
    }
    if (doc === 'oauth-authorization-server' || doc === 'openid-configuration') {
      return json(200, DOC_AS(base))
    }
    return json(404, { error: 'not_found' })
  }

  // ── enregistrement dynamique du client (RFC 7591) ──
  if (p1 === 'register' && req.method === 'POST') {
    // Audit 06/09 : /register est ouvert (spec OAuth dynamique) → throttle par IP contre l'enregistrement en masse
    // de clients (chaque client sert au hameçonnage du consentement, déjà atténué par l'affichage d'identité).
    // Audit 04/10 (relecture, esprit de CC-4) : IP en EMPREINTE dans rate_events, jamais en clair (cleIp).
    if (!(await rateHit('mcp-register:' + (await cleIp(req)), 3600, 30))) return json(429, { error: 'rate_limited' })
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json(400, { error: 'invalid_client_metadata' }) }
    // Audit 02/10 : 10 adresses de retour au plus (refus, plus de troncature silencieuse), 2048 caractères chacune,
    // https uniquement, et JAMAIS un hôte claude.ai / claude.com / anthropic.com : le vrai Claude s'identifie par son
    // document CIMD (aucun client /register créé depuis le 07/09) ; un client tiers qui renvoie là passerait pour Claude.
    const brut = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
    if (!brut.length) return json(400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris requis.' })
    if (brut.length > MAX_REDIRECT_URIS) {
      return json(400, { error: 'invalid_redirect_uri', error_description: `${MAX_REDIRECT_URIS} adresses de retour au plus.` })
    }
    const uris = brut.map(String)
    for (const u of uris) {
      let p: URL
      try { p = new URL(u) } catch { return json(400, { error: 'invalid_redirect_uri', error_description: 'Adresse de retour illisible.' }) }
      if (u.length > MAX_URI_LEN || p.protocol !== 'https:' || !/^https:\/\//.test(u)) {
        return json(400, { error: 'invalid_redirect_uri', error_description: `Adresse de retour https de ${MAX_URI_LEN} caractères au plus.` })
      }
      if (hoteAnthropic(p.hostname)) {
        return json(400, { error: 'invalid_redirect_uri', error_description: 'Adresse de retour réservée (claude.ai, claude.com, anthropic.com) : le client officiel Claude se connecte par son document de métadonnées (client_id = URL), pas par /register.' })
      }
    }
    const clientName = nomClientPropre(body.client_name) || 'client'
    const { data: client, error } = await svc.from('mcp_oauth_clients')
      .insert({ client_name: clientName, redirect_uris: uris })
      .select('client_id').single()
    if (error || !client) return json(500, { error: 'server_error' })
    return json(201, {
      client_id: String(client.client_id),
      client_name: clientName,
      redirect_uris: uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
  }

  // ── autorisation : on délègue le consentement à l'app (déjà connectée) ──
  if (p1 === 'authorize' && (req.method === 'GET' || req.method === 'POST')) {
    const q = url.searchParams
    const clientId = String(q.get('client_id') || '')
    const redirectUri = String(q.get('redirect_uri') || '')
    const challenge = String(q.get('code_challenge') || '')
    const method = String(q.get('code_challenge_method') || 'S256')
    if (!clientId || !redirectUri || !challenge || method !== 'S256') {
      return json(400, { error: 'invalid_request', error_description: 'client_id, redirect_uri, code_challenge (S256) requis' })
    }
    // Audit 02/10 : challenge S256 = base64url de 43 à 128 caractères (sinon on stockait n'importe quoi dans le relais)
    if (!CODE_CHALLENGE_RE.test(challenge)) {
      return json(400, { error: 'invalid_request', error_description: 'code_challenge invalide (base64url, 43 à 128 caractères)' })
    }
    // CIMD : client_id = URL → on résout vers l'uuid interne (le relai et les codes ne voient QUE l'uuid ;
    // /token résout de nouveau l'URL pour comparer au client du code — audit 02/10).
    let effClientId = clientId
    let uris: string[] = []
    if (isCimdClientId(clientId)) {
      const cimd = await resolveCimdClient(clientId)
      if (!cimd) return json(400, { error: 'invalid_client', error_description: 'client_id metadata document invalide' })
      effClientId = cimd.id
      uris = cimd.uris
    } else {
      if (!OAUTH_UUID_RE.test(clientId)) return json(400, { error: 'invalid_client' })
      const { data: client } = await svc.from('mcp_oauth_clients')
        .select('client_id, redirect_uris').eq('client_id', clientId).maybeSingle()
      if (!client) return json(400, { error: 'invalid_client' })
      uris = (client.redirect_uris as string[]) || []
    }
    if (!redirectUriAllowed(redirectUri, uris)) return json(400, { error: 'invalid_redirect_uri' })
    const relai = btoa(JSON.stringify({
      client_id: effClientId, redirect_uri: redirectUri, state: String(q.get('state') || ''),
      code_challenge: challenge, scope: String(q.get('scope') || 'avatarads'),
    })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return new Response(null, { status: 302, headers: { ...cors, Location: `${CONSENT_URL}?mcp_oauth=${relai}` } })
  }

  // ── identité du client pour la page de consentement (contrat C2, audit 02/10) ──
  // GET public (aucune donnée de compte : seulement l'enregistrement du client). trusted est calculé ICI et nulle part
  // ailleurs ; client_id = uuid du relais (ou URL CIMD déjà connue, sans fetch). Client inconnu ou retour non
  // enregistré pour ce client → 404 (la page garde alors le bandeau « Application externe »).
  if (p1 === 'oauth' && segs[2] === 'client-info' && req.method === 'GET') {
    const clientId = String(url.searchParams.get('client_id') || ''), redirectUri = String(url.searchParams.get('redirect_uri') || '')
    const absent = () => json(404, { ok: false, error: 'not_found' })
    if (!clientId || !redirectUri || clientId.length > MAX_URI_LEN || redirectUri.length > MAX_URI_LEN) return absent()
    const sel = svc.from('mcp_oauth_clients').select('client_id, client_name, redirect_uris, cimd_url')
    const { data: c } = isCimdClientId(clientId) ? await sel.eq('cimd_url', clientId).maybeSingle()
      : OAUTH_UUID_RE.test(clientId) ? await sel.eq('client_id', clientId).maybeSingle() : { data: null }
    if (!c || !redirectUriAllowed(redirectUri, (c.redirect_uris as string[]) || [])) return absent()
    return json(200, { ok: true, ...identiteClient(c, redirectUri) })
  }

  // ── consentement approuvé par l'app (JWT utilisateur) → code ──
  if (p1 === 'oauth' && segs[2] === 'approve' && req.method === 'POST') {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!jwt) return json(401, { error: 'unauthorized' })
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: { user }, error } = await userClient.auth.getUser()
    if (error || !user) return json(401, { error: 'unauthorized' })
    // Audit 02/10 : 30 approbations par heure et par compte (une connexion normale en demande une)
    if (!(await rateHit('mcp-approve:' + user.id, 3600, 30))) {
      return json(429, { error: 'rate_limited', error_description: 'Trop d’autorisations demandées en une heure : réessaie plus tard.' })
    }
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }
    const clientId = String(body.client_id || ''), redirectUri = String(body.redirect_uri || '')
    const challenge = String(body.code_challenge || ''), state = String(body.state || '')
    // Audit 02/10 : challenge au format S256 (base64url, 43 à 128) et client_id uuid avant toute requête
    if (!CODE_CHALLENGE_RE.test(challenge) || !OAUTH_UUID_RE.test(clientId)) return json(400, { error: 'invalid_request' })
    const { data: client } = await svc.from('mcp_oauth_clients')
      .select('client_id, redirect_uris').eq('client_id', clientId).maybeSingle()
    // redirectUriAllowed (et non .includes) : port éphémère des redirections
    // loopback des clients CIMD type Claude Code (RFC 8252 §7.3).
    if (!client || !redirectUriAllowed(redirectUri, (client.redirect_uris as string[]) || [])) {
      return json(400, { error: 'invalid_request' })
    }
    const code = 'aac_' + hexAleatoire(24)
    const { error: insErr } = await svc.from('mcp_oauth_codes').insert({
      code_hash: await hashKey(code), client_id: clientId, user_id: user.id,
      redirect_uri: redirectUri, code_challenge: challenge,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    if (insErr) return json(500, { error: 'server_error' })
    const sep = redirectUri.includes('?') ? '&' : '?'
    return json(200, { redirect_url: `${redirectUri}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}` })
  }

  // ── échange du code contre le jeton (PKCE) + refresh ──
  if (p1 === 'token' && req.method === 'POST') {
    const ct = req.headers.get('content-type') || ''
    let form: URLSearchParams
    if (ct.includes('application/json')) {
      const j = await req.json().catch(() => ({}))
      form = new URLSearchParams(Object.entries(j).map(([k, v]) => [k, String(v)]))
    } else {
      form = new URLSearchParams(await req.text())
    }
    const grant = form.get('grant_type') || ''

    if (grant === 'authorization_code') {
      const code = form.get('code') || '', verifier = form.get('code_verifier') || ''
      const redirectUri = form.get('redirect_uri') || '', clientIdIn = form.get('client_id') || ''
      if (!code || !verifier) return json(400, { error: 'invalid_request' })
      // Audit 02/10 : client_id ET redirect_uri EXIGÉS (OAuth 2.1 §4.1.3 pour un client public ; les SDK MCP de
      // claude.ai / Claude Code envoient les deux). Soupape d'urgence sans redéploiement : secret MCP_TOKEN_LAX=1
      // tolère leur ABSENCE (jamais une valeur différente) — lu à chaque requête.
      const lax = (Deno.env.get('MCP_TOKEN_LAX') ?? '') === '1'
      if (!lax && (!clientIdIn || !redirectUri)) {
        console.warn('[oauth/token] échange refusé : ' + (!clientIdIn ? 'client_id' : 'redirect_uri') + ' absent')
        return json(400, { error: 'invalid_request', error_description: 'client_id et redirect_uri requis' })
      }
      // client_id résolu AVANT de consommer le code (URL CIMD → uuid interne) : un client inconnu ne brûle pas le code
      const clientUuid = clientIdIn ? await clientUuidDe(clientIdIn) : null
      if (clientIdIn && !clientUuid) return json(400, { error: 'invalid_client' })
      // audit 02/10 : code consommé ATOMIQUEMENT (delete … returning) — deux échanges concurrents du même code ne
      // donnent plus deux jetons
      const { data: used } = await svc.from('mcp_oauth_codes').delete().eq('code_hash', await hashKey(code)).select('*')
      const row = used && used.length === 1 ? used[0] : null
      if (!row) return json(400, { error: 'invalid_grant' })
      if (new Date(String(row.expires_at)).getTime() < Date.now()) return json(400, { error: 'invalid_grant', error_description: 'code expiré' })
      // Audit 02/10 : le code appartient à UN client et à UN retour — toute différence le brûle (déjà supprimé ci-dessus)
      if (redirectUri && redirectUri !== row.redirect_uri) return json(400, { error: 'invalid_grant' })
      if (clientUuid && clientUuid !== String(row.client_id).toLowerCase()) return json(400, { error: 'invalid_grant' })
      if (await sha256b64url(verifier) !== String(row.code_challenge)) return json(400, { error: 'invalid_grant', error_description: 'PKCE' })
      const access = 'aat_' + hexAleatoire(24), refresh = 'aar_' + hexAleatoire(24)
      // Nouvelle FAMILLE de refresh : family_id / family_started_at posés par les DEFAULT de la table (migration
      // 20261003070000) → cette insertion marche aussi avant la migration.
      const { error: insErr } = await svc.from('mcp_oauth_tokens').insert({
        token_hash: await hashKey(access), refresh_hash: await hashKey(refresh),
        client_id: row.client_id, user_id: row.user_id,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      })
      if (insErr) return json(500, { error: 'server_error' })
      return json(200, { access_token: access, token_type: 'Bearer',
        expires_in: Math.floor(TOKEN_TTL_MS / 1000), refresh_token: refresh, scope: 'avatarads' })
    }

    if (grant === 'refresh_token') {
      const refresh = form.get('refresh_token') || ''
      if (!refresh) return json(400, { error: 'invalid_request' })
      const access = 'aat_' + hexAleatoire(24), refresh2 = 'aar_' + hexAleatoire(24)
      // Audit 02/10 : rotation par FAMILLE, atomique en base (mcp_oauth_rotate) — fin absolue 90 jours, refresh déjà
      // tourné présenté hors des 60 s de grâce = famille entière révoquée (vol probable), accès plafonné à la fin de famille.
      const { data: rot, error: rotErr } = await svc.rpc('mcp_oauth_rotate', {
        p_refresh_hash: await hashKey(refresh), p_new_token_hash: await hashKey(access), p_new_refresh_hash: await hashKey(refresh2),
        p_access_ttl_s: Math.floor(TOKEN_TTL_MS / 1000), p_family_ttl_s: Math.floor(FAMILY_TTL_MS / 1000),
        p_grace_s: REFRESH_GRACE_S, p_old_access_s: OLD_ACCESS_S,
      })
      // RPC absente (fonction déployée avant la migration) → ancienne rotation ci-dessous, pour ne déconnecter personne.
      const rpcAbsente = !!rotErr && ['PGRST202', '42883'].includes(String(rotErr.code || ''))
      if (rotErr && !rpcAbsente) { console.error('[oauth/token] rotation : ' + rotErr.message); return json(500, { error: 'server_error' }) }
      if (!rotErr) {
        const r = (rot || {}) as { ok?: boolean, error?: string, expires_in?: number, revoked?: number }
        if (!r.ok) {
          if (r.error === 'reuse') console.warn('[oauth/token] refresh déjà tourné présenté : famille révoquée (' + (r.revoked ?? 0) + ' jeton(s))')
          if (r.error === 'expired') return json(400, { error: 'invalid_grant', error_description: 'Connexion expirée (90 jours) : reconnecte AvatarAds dans Claude.' })
          return json(400, { error: 'invalid_grant' })
        }
        return json(200, { access_token: access, token_type: 'Bearer',
          expires_in: Math.max(1, Math.floor(Number(r.expires_in) || 0)), refresh_token: refresh2, scope: 'avatarads' })
      }
      console.error('[oauth/token] RPC mcp_oauth_rotate absente : appliquer la migration 20261003070000 (ancienne rotation utilisée)')
      const { data: row } = await svc.from('mcp_oauth_tokens').select('*')
        .eq('refresh_hash', await hashKey(refresh)).maybeSingle()
      if (!row) return json(400, { error: 'invalid_grant' })
      // Rotation DOUCE : l'ancien access reste valable 10 min (une autre session
      // claude.ai peut encore l'avoir en main — un delete sec la mettait en 401
      // « Problème de connexion »). L'ancien refresh, lui, meurt tout de suite
      // (écrasé par un hash jamais distribué, la colonne est NOT NULL + unique).
      // audit 02/10 : rotation ATOMIQUE — l'ancien refresh n'est consommé qu'une fois (compare-and-swap sur refresh_hash)
      const { data: rotAncien } = await svc.from('mcp_oauth_tokens').update({
        // audit 28/09 : jamais PROLONGER un access déjà expiré (rotation d'un vieux refresh = 10 min de plus)
        expires_at: new Date(Math.min(Date.parse(String(row.expires_at)) || 0, Date.now() + 10 * 60 * 1000)).toISOString(),
        refresh_hash: await hashKey('dead_' + hexAleatoire(24)),
      }).eq('token_hash', row.token_hash).eq('refresh_hash', await hashKey(refresh)).select('token_hash')
      if (!rotAncien || rotAncien.length !== 1) return json(400, { error: 'invalid_grant' })
      const { error: insErr } = await svc.from('mcp_oauth_tokens').insert({
        token_hash: await hashKey(access), refresh_hash: await hashKey(refresh2),
        client_id: row.client_id, user_id: row.user_id,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      })
      if (insErr) return json(500, { error: 'server_error' })
      return json(200, { access_token: access, token_type: 'Bearer',
        expires_in: Math.floor(TOKEN_TTL_MS / 1000), refresh_token: refresh2, scope: 'avatarads' })
    }

    return json(400, { error: 'unsupported_grant_type' })
  }

  // ── Audit 04/10 (MCP-1) : révocation d'un jeton par le client (RFC 7009) ──
  // Client public (aucun secret) : détenir le jeton suffit à le révoquer. Accès (aat_) ou refresh (aar_) → toute la FAMILLE
  // (accès + refresh issus du même consentement) est supprimée. Réponse 200 identique que le jeton existe ou non (§2.2) ;
  // client_id fourni → le jeton doit être le sien, sinon rien n'est révoqué (même réponse).
  if (p1 === 'revoke' && req.method === 'POST') {
    if (!(await rateHit('mcp-revoke:' + (await cleIp(req)), 3600, 60))) return json(429, { error: 'rate_limited' })   // IP en empreinte (relecture)
    let form: URLSearchParams
    try {
      if ((req.headers.get('content-type') || '').includes('application/json')) {
        const j = await req.json()
        form = new URLSearchParams(Object.entries((j && typeof j === 'object') ? j : {}).map(([k, v]) => [k, String(v)]))
      } else form = new URLSearchParams(await req.text())
    } catch { return json(400, { error: 'invalid_request' }) }
    const token = String(form.get('token') || '').trim()
    if (!token) return json(400, { error: 'invalid_request' })
    if (/^aa[tr]_[0-9a-f]{48}$/.test(token)) {
      const col = token.startsWith('aat_') ? 'token_hash' : 'refresh_hash'
      const h = await hashKey(token)
      const clientIn = String(form.get('client_id') || '')
      const clientUuid = clientIn ? await clientUuidDe(clientIn) : null
      const { data: row, error: rowErr } = await svc.from('mcp_oauth_tokens').select('token_hash, client_id, family_id').eq(col, h).maybeSingle()
      if (rowErr) {
        console.error('[oauth/revoke] lecture : ' + rowErr.message)
        if (!clientIn) await svc.from('mcp_oauth_tokens').delete().eq(col, h)   // repli sans famille (colonne absente)
      } else if (row && (!clientIn || (clientUuid !== null && clientUuid === String(row.client_id).toLowerCase()))) {
        const { error: delErr } = row.family_id
          ? await svc.from('mcp_oauth_tokens').delete().eq('family_id', row.family_id)
          : await svc.from('mcp_oauth_tokens').delete().eq('token_hash', row.token_hash)
        if (delErr) { console.error('[oauth/revoke] suppression : ' + delErr.message); return json(503, { error: 'server_error' }) }
      }
    }
    return new Response(null, { status: 200, headers: { ...cors, 'Cache-Control': 'no-store' } })
  }

  return null
}

// ── Gestion de la clé personnelle (appelée par l'app avec le JWT utilisateur) ──
async function handleKeyManagement(req: Request): Promise<Response> {
  const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  if (!token) return json(401, { error: 'unauthorized' })
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return json(401, { error: 'unauthorized' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }

  const { data: prof } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
  const planAllowed = !!prof && (isUnlimited(prof) || ALLOWED_PLANS.includes(String(prof.plan || '').toLowerCase()))

  if (body.action === 'status') {
    const { data } = await svc.from('mcp_keys').select('created_at, last_used_at, require_confirm')
      .eq('user_id', user.id).is('revoked_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    // Audit 04/10 (MCP-1, CC-2) : connexions Claude par OAuth encore vivantes (jeton non tourné, famille de moins de 90 jours)
    // → l'app peut dire « Claude est relié » à côté de « Déconnecter Claude ». Champs AJOUTÉS (anciens clients : ignorés).
    let oauthConnexions = 0, oauthDernier: string | null = null
    try {
      const { data: toks } = await svc.from('mcp_oauth_tokens').select('last_used_at, created_at')
        .eq('user_id', user.id).is('rotated_at', null).gt('family_started_at', new Date(Date.now() - FAMILY_TTL_MS).toISOString()).limit(100)
      for (const t of (toks || []) as { last_used_at: string | null, created_at: string | null }[]) {
        oauthConnexions++
        const d = t.last_used_at || t.created_at
        if (d && (!oauthDernier || d > oauthDernier)) oauthDernier = d
      }
    } catch (_) { /* information de confort */ }
    return json(200, {
      exists: !!data, created_at: data?.created_at ?? null, last_used_at: data?.last_used_at ?? null,
      // défaut false (29/08) : l'option confirmation quitte l'UI, les nouvelles
      // clés partent sans devis ; une clé existante garde sa valeur stockée.
      require_confirm: data?.require_confirm ?? true, plan_allowed: planAllowed,
      oauth_connections: oauthConnexions, oauth_last_used_at: oauthDernier,
    })
  }
  if (body.action === 'create') {
    // Axel 02/10 : connexion par CLÉ DANS L'URL supprimée — OAuth uniquement (aucun lien secret qui puisse fuiter)
    return json(410, { error: 'key_mode_disabled', message: 'La connexion par clé a été remplacée par la connexion sécurisée OAuth : utilise « Relier à Claude ».' })
    if (!planAllowed) return json(403, { error: 'plan_required' }) // réservé Pro/Élite
    const raw = new Uint8Array(24)
    crypto.getRandomValues(raw)
    const key = 'aa_' + Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('')
    await svc.from('mcp_keys').update({ revoked_at: new Date().toISOString() }).eq('user_id', user.id).is('revoked_at', null)
    // require_confirm: false PAR DEFAUT (Axel, 29/08) — l'option « demander
    // confirmation » disparaît de l'UI (Anthropic confirme déjà côté client).
    // Explicite ici + défaut colonne passé à false ; les clés existantes
    // gardent leur réglage, et set_confirm reste fonctionnel pour qui l'a.
    const { error: insErr } = await svc.from('mcp_keys').insert({ user_id: user.id, key_hash: await hashKey(key), require_confirm: false })   // Axel 01/10 : plus de devis (le serveur ne le réclame plus de toute façon)
    if (insErr) return json(500, { error: 'server_error' })
    return json(200, { ok: true, url: `${MCP_PUBLIC_BASE}/${key}` })
  }
  if (body.action === 'revoke') {
    await svc.from('mcp_keys').update({ revoked_at: new Date().toISOString() }).eq('user_id', user.id).is('revoked_at', null)
    // Audit 28/09 (moyenne) : « Révoquer » coupe AUSSI l'accès OAuth (Claude connecté par OAuth gardait ses jetons à vie :
    // le refresh ne vérifie que son empreinte). Jetons et codes du compte supprimés = identifiants invalidés.
    await svc.from('mcp_oauth_tokens').delete().eq('user_id', user.id)
    await svc.from('mcp_oauth_codes').delete().eq('user_id', user.id)
    return json(200, { ok: true })
  }
  if (body.action === 'set_confirm') {
    await svc.from('mcp_keys').update({ require_confirm: body.value !== false && body.value !== 'false' })
      .eq('user_id', user.id).is('revoked_at', null)
    return json(200, { ok: true })
  }
  return json(400, { error: 'bad_request' })
}

// Icône plein bord 256×256 (PNG, ~4 Ko) — même dessin que /icon.svg, pour les clients qui veulent du raster.
const ICON_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAQAElEQVR4AeydSbYcxw1F/9FQXJM05pqksbQmjqU1cWzzHhF2spRVlQ0QgQCej+DsogEugJf5P2n5p59//vk/MjFQDfSsgZ8+9B8REIG2BCQAbVOvwEXg40MCoCoQgaYECFsCAAWZCDQlIAFomniFLQIQkABAQSYCTQlIAJomXmH3JmDRSwCMhI4i0JCABKBh0hWyCBgBCYCR0FEEGhKQADRMukLuTWAbvQRgS0PnItCMgASgWcIVrghsCUgAtjR0LgLNCEgAmiVc4fYm8Bi9BOCRiK5FoBEBCUCjZCtUEXgkIAF4JKJrEWhEQALQKNkKtTeBveglAHtUdE8EmhCQADRJtMIUgT0CEoA9KronAk0ISACaJFph9ibwLHoJwDMyui8CDQhIABokWSGKwDMCEoBnZHRfBBoQkAA0SLJC7E3gVfQSgFd09EwEihOQABRPsMITgVcEJACv6OiZCBQnIAEonmCF15vAu+glAO8I6bkIFCYgASicXIUmAu8ISADeEdJzEShMQAJQOLkKrTeBI9FLAI5Q0hgRKEpAAlA0sQpLBI4QkAAcoaQxIlCUgASgaGIVVm8CR6OXABwlpXEiUJCABKBgUhWSCBwlIAE4SkrjRKAgAQlAwaQqpN4EzkQvAThDS2NFoBgBCUCxhCocEThDQAJwhpbGikAxAhKAYglVOL0JnI1eAnCWmMaLQCECEoBCyVQoInCWgATgLDGNF4FCBCQAhZKpUHoTuBK9BOAKNc0RgSIEJABFEqkwROAKAQnAFWqaIwJFCEgAiiRSYfQmcDV6CcBVcponAgUISAAKJPExhF9++eUD+/333z+wL1++fGBfv379OGKMxZiLsRb2uI+u1ycgAVg8hzQmTUrDYjQ4R+y33377wBiDHQ2VsRhzMdbCbG32wxhzdE2Ny0lAApAzL7te0XA0Hs2IWUPSpDzDdic63mQP9sPMB/zAL4znjttpqQME7gyRANyhFzyXZqKprNE40njcx4K3P7U8fmH4iCBwxPdsfp4KqsFgCUCiJNMsNA3NY01EU3E/kZuHXMFnfN/GQmzcP7SABg0hIAEYgvn5JjTEtkloGu49n7HmE2IiNosVMcDWjKaO1xKAwbmkETBrBI5cD3Zj+naIAWZfOhKDaym5O0sCcJfggfk0OI2+Ne4dmNpiCCxMDBAExIB7LYKfHKQEICgBFPBjw3MvaLtSyyIGsJMYxKdVAuDImAbHKF6Mc8xxi3ZLmRjAky+DdgCCA5YAOACmySlQM64dltUSGwIwRQzsq0Bi8PGxwXP5VAJwER0FScNTkBy5vriUpp0kgBBgsEcIxP4kwM1wCcAGxpFTio2Gxzg/Mkdj4gggBOQCQwzidqq5sgTgQF5pdIqLNw6FxvWBaRoykAA5QQzIEbkauPXSW0kAXqSPoqLhMYrrxVA9SkSAXJkQVBUDL9wSgB2S28bnfGeIbi1AACHAEAFsAZeHuygB2CCn2XnbY5xvHul0YQKIAGZfBQuH4u66BOAbUpqdpsc4/3ZL/xQlICH4MbGtBYBmp+kxzn9Eo6vKBFYWAs+8tBQAmp2mxzj3BKq11iLQXQhaCQDNTtNjnK9VqvI2kkBXIWghADQ7TY9xHllIWnttAggBf2LQpU7KCwBNj3VJ6Nrtl8N7RICaQQhyePR/L7zPygoAyeOPfdT43iXTZz2EgBqilqpGXU4AaHjUm+RVTZriGkuAWqKmqK2xO8fvVkoAUOqqiYovBe3wigDNT21RY6/GrfashABYclDq1RIgf9ciQI3N+rEggtTyAoAio8yIQAQgrSkCewQQAmpv79lK95YVABqexicRKwGXr3UIUHurfw0sKQAoL82PCNQpJ0WyKgGEgJpc0f/lBIDGB/iKsOVzXQLUZKQIRJFbRgB42/O5xTEKhtYVgTsEEAFqdCUhWEIAAMqb/05yNFcERhFACKjZUfvd2Se9AAASoHeC1FwRGE2AmqV2R+97dr/UAsBbH5Bng9J4EchAgNqlhu/6Ejk/pQDwcz7gOEYGr7VFIJoANczvBThG73Vl/XQCACg1/5VUak5mAllrOpUAWPNnTqR8E4GrBDKKQBoBUPNfLSvNW4nAWRGIji2FAKj5o9Os9TMRyCQC0wVAzZ+pNOXLKAJZRGCqAKj5R5Wb9slIIIMITBUAAGRMjHwSgVEEXvXACB+mCcDswEfA1R4icITAzF6YIgD8FUk+/4/A0RgRqE6AXpglAsMFgObnr0hWT6riE4EzBBABeuPMHI+xQwWAAKs0/99///2B/fnnnx/Y58+fP8w+ffr0v3Oebc0jaVXXgCdmvIzn49Ge25E5FZjQGwgBsYyyoQJAgKMC896HIsMoxm2D//HHHx8Yz8zY2855tjXmYla8jO1qxgimWzNe9vzxaM/tyNwtU8avynT0jwLDBIC3/2pJoZCsuDhi3POIw4qXwmVdBMFj3RXWgCExm3GN3fXdmLIuXFdlOlIEhggAzb/S259ipIgwzu8W5rv57EHxrly072LkOQ1JjKO4bpnCGB9WMH4MwEb4OkQAVml+ioTixDgfkYDHPbZF+/hsxWs4wpPGJ7YZMbAvPiBA2AwfzuzJ2FFfAeECwNufgLIbhUGRULAZfKVoaRr8yuDPFR9gmY0pXFdhOqJ3QgWAz5jsb38rUgrjSpFHz8GvVQp2ywKfaf7tvSznMMU3cp/Fpz0/6B16aO+Z171QAfj111+9/AxZx4o0eyGsUrAkCZY0Fz5zndXMT2ogq4/4Ff0VECYAOI6CEURGI/HZi3TLbYWChSnNj69b3zOfUwP4ncXHRz/4AsAe73tdhwmAl4MR65BwEh+xdvSa+J2xwfAJ36Ljj1gfv6mJiLU91uRl6rHO3hohAoDDWd/+JJqE78FY5V62tyzNj0+r8Nvzk5qgNvaezb7HFwAW4UeIAEQ46rEmCSbRHmvNXoOGo/Fm+4EP+DLbD4/9qQ1qxGMt7zV4qXqvyXohApDx7U9iSTBBV7EMjZfBB898UiOImueaR9d6NW6ZL4AopXoF58gzEntk3GpjELZZPs/cOzLmrLUSIQLuXwARTt5NdtVChQvFOuONxZ7sjQ/VjNgy1kzEy9VVAGh+LFtBVC1U4zwjPprE9q94hGm2GOktzJO3qwBk/Is/GZXcM4GsRaGOjJO9aBD2rmwjY5zF0VUAZgXxbN8uhUr8I4t15F7ENssQVmzW/nv7ev8Y4CoAGX/7vwex6r0RxYqoVuW3F1c2sUv7I4C3Y3vJOHsvW/LO+n92fLd4z/K5Mn6EqJ71y7PX3L4Asv383+1NRRGNKNaOIhPNldzNMjcBmBWA9v2RQGSxdhRV6GYTPc/fA7gJgOdnCdDvWrak3Y3n6PyucR/lc2VcpKhe8cdzTlkB8ISktf4h8Ndff/1z0vC/M4mA58vWTQAy1USmZI3mEhl75NqjOWXZb7YfJQVgNlTtLwKrECgpAHpTrVJ+6/hZtaZcBMDzZ5J1SiKvpxHFGrFmXoL5PfPqORcByI9LHorAPQIRvwC955HPbAmAD0etUpxAtr/o5oXbRQD0eeiVDp91vD4PfbzRKhEEvHrORQAiAryzphrgDr39uWK6z2X1uyUFYPWkyP98BLwFMEuEEoAsmXDyI7JQI9d2Cj9smaqxlxSAqsk6Ut1Vf1l1JHaNOU/ATQC8filxPoT9GZ1FYJ/I/bue/yu0+96MWyFb3J695iYA49JxbKdsSTvm9f1Rkf9WJonq/fywwl1LKQCeTt0FxPyOxTpC9DpyjRRVanWmuX0BZPybUh2LNbqYRohMdAxn1s8Yr2evuQnAGaijxmZMXmTsI95UEtXIDB5b2/Nr200APJ06huH9KIoVez9y/REjxW7kXjMzQ+14i+rMePb2dhMAFs8oAl2KdWShshfNQc4rW8ba8e4xVwHI+O+jo1AzJtKzcWbEN2NPT2bv1iI+aufduNHPUwvAaBhH9+ONdXTsauMo1Bnx0RzYaryO+juD6RHfPH8ByH6uXwCoE8bC2ezLly/ZXHLxZ2ahVmWKqLok52ERj0vv/nIVAI8Ao9bgbZU5sVfiztCAGXy4wu7ZHGpkpqg+84v7Ef+/DO4CkPH3AMDDSCwJ5nx1Iw5EbXYc+FBFBGBKjcxmOnJ/dwHw/kTxhkGCSbT3uiPXw3/iGLnnq70QAXx6NSb7M/zPxHSPV8TL1V0AcFwiAIUYy1qoNA++xUQduyp+43/kLnfXjvj8x6cQAYhQKpz1NBJO4j3XjF6LT238jt7n6vr4thpT/MXvqzGvPi9EAPgCwLLDIfEUQHY/+cT++vXrB8fsvsIUX7NzhWV2QbVc00tRL9UQAcDxKIdZ29OyFyyNRKF6xjxiLbji+4i9zu5hzc/x7NwZ4xGAqH3DBCDS6QgY2QqW4qTx8Ssi3hFr4jsxZBECY4pPI+K3Pe4eI1+mYQJA0CuKgH2+zirabZFyDseVjRgQAuM6IxZ8oOkxzmf4cHXPqF/+mT+hAvD582fbZ6kjBYshAtgI59mHAsVWK9KjfGA6UgjgCE+M86N+ZhoX+fYnzlABYINoBWOPKKNgMStamtSrkFiHwsRYn324FxVLpnWJlZiJ3ZspDFnX1uc6U+xnfBnRO+ECEK1gZ4DeGUvRYlZcFK4ZRWa23cPucbSxNp8j97HtnE7nxL5lChPjxJHn2JYJ12aMwZhnDc85z7dzZp7f2XtE74QLAABW/VEA358ZhWtG0ZlRiGZ2j6ONrVKcz7jcuQ8b48QRbpjx5Mi1GWMw5t3ZN+PcEW9/4h4iAPwyEGNDmQiIwHsCI97+eDFEANhoVEDsJROBlQmMevvDaJgA8AUwMjCCk4nATAJX9qZHRr4shwkAMAgMIeBcJgIi8CMBeoMe+fFu7NVQASCU0QGyp0wEViAwozeGCwAqx2fOCgmRjyIwigA9QW+M2s/2GS4AbIzSzQiWvWUiMILAmT3oBXrizByvsVMEAOf5uwEEzrlMBLoSoAfohVnxTxMAAp6leuwt+/ig+DCxmEdgdg9MFQCKb6b6zUt7jp3hP7sAc5CY4wW1Tw7m7P7PrlMFABcAwC9AOJeNIwBzmh/+2Lid6+90JEL4Z+A+XQCARSEChHPZGAIwt52253ZPxzgC1HoW5ikEANQAAQznslgCj5x5Ez3ei/Wg7+pwptazEEgjAAABDIA4l8UQgC+cH1fnHkLweF/XfgSesffb4fxKqQQA9ylEQHEu8ycA32ervnr2bI7u/0jg2RU1nZFvOgEAIKAAxrnMj8A7pnwBvBvj502flWBKTWeMOKUAAApg/DEJ57L7BI4WIdwRgvs7agUIUMMw5TyjpRUAYFGInz59+qB4uZZdJ3CmCCla2F/fTTPhR+1yzEwjtQAYOIpXImA0zh9p6LOzYH52TvfxFj+1eoW5zR95XEIAAEJBApZz2XECMLvyFmIOc4/vpJEQgBm1yvkKtowAABOwfFYBmWvZawJwgtnrUc+fMpc1no/QEyOAMpZh/gAABHdJREFUYPLWh5ndW+G4lAAYUCCrMI3G/hE+cNp/evwua7DW8Rn9RsKH5kcEVot+SQEAMoWprwFI/NsoRPj8+8m1O6zFmtdm150FE2oQPqtGuawAGHDgo8B23f1IUfI28ubAmqztve6K68EBHtiK/m99Xl4ACAYRQIm7C4EVJkwijIJnj4i1V1kTBlgVDiUEwIqnsxBQkBSmsYg6skdHoSVmXjJwjmI7Y91SAmAAuwkBxUljWvzRR/iyZ/Q+GdYnThqfmJ/5s/L9kgJgCSFpJI8kVlNui5HYiNOuRx3Zk71H7TdyH2oFQaV2iHPk3qP3Ki0ABpMkklCsStFakRKbxTn6yN4wHb1v1H7GlJg4j9on07otBMCAk1SKFmVHCLi2Zysd8T1LkcLQeK7E0HzFf1gSA0eu7VmHYysB2CYUISDhJJ6GwrbPM55TnPiL79n8wyd8W4UjuTeD61Weq89rKwDbxFG8mBVwtiKmQK1Yt35nPIcjvmZiCD8Mv8gxR66xjAxH+iQBeKBNAWMUCkYhY6OLhf0oVHzgyPWDq2kv8dUYwg4b6Sz7syfcjB/n3B/pxwp7SQDeZIlCxiggKyaKy4yiwt4s8/Yxa2DsY8b124nJB8AOgx3MvGJiHTPWNWbswzl78jw5nunuSQBOpoCiorjMKDaMwsM43xrFuWc2hjmYXbM+dtKtJYbDjDiJ14xr7BUjnps9zuM+68IMGwmiwl4SAOcsUoRbozj3zMY4b7/ccsbhFSMbw3G5AJM7LAFIniC5JwKRBCQAkXS1tggkJyABSJ4guZeTQBWvJABVMqk4ROACAQnABWiaIgJVCEgAqmRScYjABQISgAvQNKU3gUrRSwAqZVOxiMBJAhKAk8A0XAQqEZAAVMqmYhGBkwQkACeBaXhvAtWilwBUy6jiEYETBCQAJ2BpqAhUIyABqJZRxSMCJwhIAE7A0tDeBCpGLwGomFXFJAIHCUgADoLSMBGoSEACUDGrikkEDhKQABwEpWG9CVSNXgJQNbOKSwQOEJAAHICkISJQlYAEoGpmFZcIHCAgATgASUN6E6gcvQSgcnYVmwi8ISABeANIj0WgMgEJQOXsKjYReENAAvAGkB73JlA9eglA9QwrPhF4QUAC8AKOHolAdQISgOoZVnwi8IKABOAFHD3qTaBD9BKADllWjCLwhIAE4AkY3RaBDgQkAB2yrBhF4AkBCcATMLrdm0CX6CUAXTKtOEVgh4AEYAeKbolAFwISgC6ZVpwisENAArADRbd6E+gUvQSgU7YVqwg8EJAAPADRpQh0IiAB6JRtxSoCDwQkAA9AdNmbQLfoJQDdMq54RWBDQAKwgaFTEehGQALQLeOKVwQ2BCQAGxg67U2gY/QSgI5ZV8wi8J2ABOA7CB1EoCMBCUDHrCtmEfhOQALwHYQOvQl0jV4C0DXzilsEvhGQAHyDoH9EoCsBCUDXzCtuEfhGQALwDYL+6U2gc/QSgM7ZV+ztCUgA2peAAHQmIAHonH3F3p6ABKB9CfQG0D36/wIAAP//DM9wIwAAAAZJREFUAwB/HBeIduIONAAAAABJRU5ErkJggg=='

// ── Endpoint MCP ──
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(req.url)
  const segs = url.pathname.split('/').filter(Boolean) // ['mcp', '<clé>' | 'key' | 'i']

  // Lien de téléchargement de MARQUE : mcp.avatarads.fr/i/<jobId> → 302 vers une URL SIGNÉE (1 h) du média (mcp-media est
  // PRIVÉ depuis le 28/09) : un raccourci propre à la place du long lien supabase. Aucune auth : le job_id sert de lien.
  if (segs[1] === 'i' && segs[2]) {
    const { data: j0 } = await svc.from('mcp_jobs').select('result_url, kind, params').eq('id', segs[2]).maybeSingle()
    // ?photo=1 (Axel 01/10) : la PHOTO DE DÉPART d'une vidéo Express, téléchargée via ce lien de marque (jamais un lien Supabase)
    const photo = new URL(req.url).searchParams.get('photo') === '1'
    const startFull = String(((j0?.params as Record<string, unknown> | null) || {}).start_full || ((j0?.params as Record<string, unknown> | null) || {}).preview || '')
    const j = photo ? (startFull ? { result_url: startFull, kind: 'image' } : null) : j0
    const dest = j?.result_url ? await signMedia(String(j.result_url), 3600) : ''   // mcp-media privé : lien signé 1 h
    if (!dest) return new Response('Média introuvable', { status: 404, headers: cors })
    // signature impossible = fichier purgé (RGPD, 28/09 : médias créés via Claude conservés 30 jours) → message clair
    if (dest.startsWith(MEDIA_PUB)) return new Response('Ce lien a expiré : les médias créés via Claude sont conservés 30 jours. Une copie est rangée dans ta Bibliothèque AvatarAds (garde-la en favori pour la conserver au-delà de 30 jours).', { status: 410, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } })
    const dl = new URL(req.url).searchParams.get('download')
    // TÉLÉCHARGEMENT d'une IMAGE : on relaie les octets NOUS-MÊMES (single-origin, application/
    // octet-stream) au lieu d'un 302 cross-origin vers Supabase. Le saut cross-origin PENDANT un
    // download, dans le contexte hôte claude.ai (Safari), faisait planter/fermer Safari (11/09).
    // Les images sont petites (~2-3 Mo) → relais sûr et forcé en fichier (jamais rendu inline).
    // Les vidéos (lourdes) restent en 302 pour ne pas streamer 20+ Mo à travers l'edge function.
    if (dl && j?.kind === 'image') {
      try {
        const r = await fetch(dest)
        if (r.ok && r.body) {
          const safe = dl.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'avatarads.png'
          const h = new Headers(cors)
          h.set('Content-Type', 'application/octet-stream')
          h.set('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(dl)}`)
          const len = r.headers.get('content-length'); if (len) h.set('Content-Length', len)
          h.set('Cache-Control', 'no-store'); h.set('X-Content-Type-Options', 'nosniff')
          return new Response(r.body, { status: 200, headers: h })
        }
      } catch (_) { /* repli sur le 302 ci-dessous */ }
    }
    // Vidéo, ou repli : 302 vers le storage (?download forwardé → Content-Disposition:attachment).
    const to = dl ? dest + (dest.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(dl) : dest
    return new Response(null, { status: 302, headers: { ...cors, Location: to, 'Cache-Control': dl ? 'no-store' : 'private, max-age=600' } })
  }

  // Statut d'un job, SONDÉ PAR LE WIDGET lui-même → une seule carte avec barre de
  // progression, plus de spam check_image. UUID = capacité (rien de sensible : l'URL
  // du média est déjà publique). CORS ACAO:* via json(). Progress = estimation temps.
  if (segs[1] === 'status' && segs[2]) {
    // Audit 28/09 #32 : route anonyme (l'UUID du job sert de capacité). Plafond PAR JOB (une IP partagée par un relais ne
    // doit pas bloquer tous les widgets) + verrou en base : UNE sonde fournisseur par job toutes les 8 s, tous isolates confondus.
    if (!/^[0-9a-f-]{36}$/i.test(segs[2])) return json(404, { status: 'unknown' })
    if (!(await rateHit('mcp-status:' + segs[2].toLowerCase(), 60, 90))) return json(429, { status: 'busy' })
    const r0 = await svc.from('mcp_jobs').select('*').eq('id', segs[2]).maybeSingle()
    let j = r0.data as Record<string, unknown> | null
    if (!j) return json(404, { status: 'unknown' })
    // Le WIDGET pilote la génération vidéo : à chaque sonde, on avance le job d'un cran
    // (1 check fournisseur + livraison si prêt). Ainsi la barre + l'affichage inline
    // marchent SANS que Claude appelle check_* → plus de « Impossible de joindre » (proxy).
    // Images : op_name null (livrées par la tâche de fond) → jamais avancées ici.
    if (j.status !== 'done' && j.status !== 'failed' && j.op_name) {
      const { data: tour } = await svc.from('mcp_jobs').update({ updated_at: new Date().toISOString() })
        .eq('id', segs[2]).eq('status', 'running').lt('updated_at', new Date(Date.now() - 8000).toISOString()).select('id')
      if (tour && tour.length) {
        if (j.kind === 'video') await advanceVideoBounded(j)
        else if (j.kind === 'avatar') await advanceAvatarJob(j)
      }
      const { data: j2 } = await svc.from('mcp_jobs').select('status, kind, result_url, created_at, error').eq('id', segs[2]).maybeSingle()
      if (j2) j = { ...j, ...j2 }
    }
    if (j.status === 'pending') return new Response(JSON.stringify({ status: 'pending', kind: j.kind, url: null, progress: 0, error: null, link_failed: ((j.params as Record<string, unknown> | null) || {}).link_failed || null }), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    const elapsed = Date.now() - new Date(String(j.created_at)).getTime()
    const outilV = String(((j.params as Record<string, unknown> | null) || {}).tool || '')
    const attendu = j.kind === 'image' ? 50000 : outilV === 'motion' ? 480000 : outilV === 'omni_edit' ? 150000 : j.kind === 'avatar' ? 200000 : 130000
    const done = j.status === 'done' || j.status === 'failed'
    const progress = done ? 100 : Math.min(94, Math.max(5, Math.round((elapsed / attendu) * 100)))
    const urlSigne = j.status === 'done' && j.result_url ? await signMedia(String(j.result_url)) : null   // mcp-media privé (audit 28/09)
    const prevRaw = (((j.params as Record<string, unknown> | null) || {}).preview as string | undefined) || null
    const preview = prevRaw && (j.status !== 'failed' || ((j.params as Record<string, unknown> | null) || {}).start_full) ? await signMedia(prevRaw) : null   // photo de départ générée (vidéo Express) — gardée après la vidéo, ET après un échec vidéo (elle reste payée)
    // message lisible SEULEMENT pour les outils vidéo (texte écrit par nous, jamais l'erreur brute d'un fournisseur)
    const msgV = j.status === 'failed' && outilV ? String(((j.params as Record<string, unknown> | null) || {}).user_msg || '') : ''
    return new Response(JSON.stringify({ status: j.status, kind: j.kind, url: urlSigne, progress, preview, error: j.status === 'failed' ? 'failed' : null, ...(msgV ? { msg: msgV } : {}) }),   // audit 05/09 : ne pas divulguer l'erreur interne (endpoint public par job_id)
      { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }

  // Lancer un job IMAGE « en attente de la photo produit » depuis la carte : {job, data_url} (photo déposée
  // dans la carte → mcp-media/<uid>/ref-…) ou {job, skip:true}. Capacité = job_id (status pending, ≤2 h),
  // passage pending→running ATOMIQUE (un seul lancement), mêmes garde-fous que /regenerate.
  // ── OUTILS VIDÉO (Omni / Motion Control, 02/10) : la carte envoie ses fichiers DIRECTEMENT au stockage ──────────────
  // /upload-url {job, cap, slot, type, size} → lien d'envoi signé (vidéo → render-media, photo → mcp-media), jamais via
  // le relais (vidéos de dizaines de Mo). /mc-face {job, cap, char, ref} → boxes visage (cadrage de l'app). Capacité
  // signée obligatoire, job « pending » de moins de 2 h.
  if ((segs[1] === 'upload-url' || segs[1] === 'mc-face') && req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const jobId = String(body.job || '')
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json(400, { error: 'bad_request' })
    if (!(await rateHit('mcp-vt:' + jobId.toLowerCase(), 60, 30))) return json(429, { error: 'busy' })
    if (!(await capOk(jobId, body.cap))) return json(403, { error: 'forbidden' })
    const { data: pj } = await svc.from('mcp_jobs').select('id, user_id, status, created_at, params').eq('id', jobId).maybeSingle()
    if (!pj) return json(404, { error: 'not_found' })
    const pp = (pj.params || {}) as Record<string, unknown>
    if (pj.status !== 'pending' || !['omni_edit', 'motion'].includes(String(pp.tool))) return json(409, { error: 'not_pending' })
    if (Date.now() - new Date(String(pj.created_at)).getTime() > 2 * 3600 * 1000) return json(403, { error: 'expired' })
    if (segs[1] === 'mc-face') {
      // 2 analyses d'image (non facturées) : 3 par carte et 20 par heure et par compte au plus (audit 02/10) ; au-delà,
      // cadrage standard sans détection (la carte continue sans erreur)
      if (!(await rateHit('mcp-face-job:' + jobId.toLowerCase(), 7200, 3)) || !(await rateHit('mcp-face:' + String(pj.user_id), 3600, 20))) return json(200, { char: null, ref: null })
      const [c, r] = await Promise.all([detecterVisage(String(body.char || '')), detecterVisage(String(body.ref || ''))])
      return json(200, { char: c, ref: r })
    }
    const slot = String(body.slot || ''), type = String(body.type || '').toLowerCase(), size = Number(body.size) || 0
    const okSlot = pp.tool === 'omni_edit' ? slot === 'video' : (slot === 'ref' || slot === 'char')
    if (!okSlot) return json(400, { error: 'bad_slot' })
    const video = slot !== 'char'
    if (video ? !/^video\/(mp4|quicktime|webm|x-m4v)$/.test(type) : type !== 'image/jpeg') return json(415, { error: 'bad_type' })
    if (!(size > 0) || size > (video ? 200_000_000 : 15_000_000)) return json(413, { error: 'too_large' })
    const ext = !video ? 'jpg' : /webm/.test(type) ? 'webm' : /quicktime/.test(type) ? 'mov' : 'mp4'
    const bucket = video ? 'render-media' : 'mcp-media'
    const path = `${pj.user_id}/mcp-src/${jobId}-${video ? 'src' : 'char'}.${ext}`
    // upsert GARDÉ (audit 02/10, MCPB-1) : un nouvel essai depuis la carte (« redépose-la », envoi coupé, photo envoyée puis
    // vidéo refusée) réécrit le MÊME chemin, et la carte envoie x-upsert. Sans risque désormais : ce fichier n'est que
    // l'ENTRÉE de la préparation ; la vidéo mesurée, facturée et lue par le moteur est la copie du worker dans
    // mcp-prep/<uid>/ (hors du dossier que l'utilisateur peut réécrire), cf. advanceVideoTool. La photo du personnage
    // (mcp-media) n'est pas facturée à la taille et /start revérifie taille et type réels.
    const { data: su, error: suE } = await svc.storage.from(bucket).createSignedUploadUrl(path, { upsert: true })
    if (suE || !su?.signedUrl) return json(500, { error: 'upload_url' })
    await svc.from('mcp_jobs').update({ params: { ...pp, [video ? 'src_path' : 'char_path']: path } }).eq('id', jobId).eq('status', 'pending')
    return json(200, { url: su.signedUrl })
  }
  if (segs[1] === 'start' && req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const jobId = String(body.job || '')
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json(400, { error: 'bad_request' })
    // capacité signée (H4/M5) vérifiée AVANT toute lecture (audit 02/10) : sans elle, 404/403 disait si le job existe
    if (!(await capOk(jobId, body.cap))) return json(403, { error: 'forbidden' })
    const { data: pj } = await svc.from('mcp_jobs').select('*').eq('id', jobId).maybeSingle()
    if (!pj) return json(404, { error: 'not_found' })
    if (pj.status !== 'pending') return json(409, { error: 'not_pending' })
    if (Date.now() - new Date(String(pj.created_at)).getTime() > 2 * 3600 * 1000) return json(403, { error: 'expired' })
    const params = (pj.params || {}) as Record<string, unknown>
    // ── OUTILS VIDÉO (Omni / Motion Control) : fichiers déjà envoyés par la carte → préparation par le serveur de rendu.
    //    Rien n'est débité ici : le débit a lieu quand la durée RÉELLE est mesurée (advanceVideoTool), avant le moteur.
    if (params.tool === 'omni_edit' || params.tool === 'motion') {
      const uid = String(pj.user_id)
      const { data: profT } = await svc.from('profiles').select('*').eq('id', uid).maybeSingle()
      if (!profT) return json(404, { error: 'no_profile' })
      if (!isUnlimited(profT) && !ALLOWED_PLANS.includes(String(profT.plan || '').toLowerCase())) return json(403, { error: 'plan' })
      // audit 02/10 (WRK-1) : chemins posés par /upload-url, revalidés (motif fermé) avant d'entrer dans render_jobs
      const src = cheminSur(uid, params.src_path) || '', chr = cheminSur(uid, params.char_path) || ''
      // taille et type RÉELS des fichiers envoyés (le lien signé ne les borne pas) — audit 02/10
      const infoV = src.startsWith(uid + '/mcp-src/' + jobId) ? await fichierInfo('render-media', src) : null
      if (!infoV) return json(400, { error: 'no_video' })
      if (infoV.size > 200_000_000 || (infoV.mime && !/^(video\/(mp4|quicktime|webm|x-m4v)|application\/octet-stream)$/.test(infoV.mime))) return json(415, { error: 'bad_type' })
      if (params.tool === 'motion') {
        const infoC = chr.startsWith(uid + '/mcp-src/' + jobId) ? await fichierInfo('mcp-media', chr) : null
        if (!infoC) return json(400, { error: 'no_char' })
        if (infoC.size > 15_000_000 || (infoC.mime && infoC.mime !== 'image/jpeg')) return json(415, { error: 'bad_type' })
      }
      // solde minimal AVANT de mobiliser le serveur de rendu (le débit exact suit la mesure de la durée) + 2 préparations
      // en cours au plus par compte : plus de préparations gratuites à 0 crédit (audit 02/10)
      if (!isUnlimited(profT)) {
        const mini = params.tool === 'omni_edit' ? OMNI_EDIT_SEC[params.resolution === '1080p' ? '1080p' : '720p'] : 4 * mcRate(params.model, params.quality)
        if ((Number(profT.credits_remaining) || 0) < mini) return json(402, { error: 'no_credits' })
        const { count } = await svc.from('render_jobs').select('id', { count: 'exact', head: true }).eq('user_id', uid).in('status', ['queued', 'rendering']).eq('plan->>__compose', 'mc-ref')
        if ((count || 0) >= 2) return json(429, { error: 'busy' })
      }
      const nowT = new Date().toISOString()
      const { data: tookT } = await svc.from('mcp_jobs').update({ status: 'running', credits_cost: 0, created_at: nowT, updated_at: nowT, params: { ...params, dur_hint: Number(body.duration) || 0 } })
        .eq('id', jobId).eq('status', 'pending').select('id')
      if (!tookT || !tookT.length) return json(409, { error: 'not_pending' })
      const { data: rj, error: rjE } = await svc.from('render_jobs').insert({ user_id: uid, status: 'queued', input_video: src, assets: [], avatar_clips: [],
        plan: { __compose: 'mc-ref', maxDur: Math.min(params.tool === 'omni_edit' ? 10 : 30, Number(params.max_dur) || 30), minDur: params.tool === 'motion',
          crop916: params.tool === 'omni_edit' } }).select('id').single()   // Omni : recadrée au format rendu (9:16 / 16:9), Axel 04/10
      if (rjE || !rj) { await failAndRefund(uid, { id: jobId }, 'préparation impossible'); return json(500, { error: 'prep' }) }
      await svc.from('mcp_jobs').update({ op_name: 'vn:' + rj.id }).eq('id', jobId).eq('status', 'running')
      return json(200, { job_id: jobId, statusUrl: `https://mcp.avatarads.fr/status/${jobId}` })
    }
    // ── CARTE VIDÉO (photo de départ déposée → Omni Flash image→vidéo) ──
    if (params.video === true) {
      const userIdV = String(pj.user_id)
      const { data: profV } = await svc.from('profiles').select('*').eq('id', userIdV).maybeSingle()
      if (!profV) return json(404, { error: 'no_profile' })
      if (!isUnlimited(profV) && !ALLOWED_PLANS.includes(String(profV.plan || '').toLowerCase())) return json(403, { error: 'plan' })
      const durV = omniFlashCran(Number(params.duration) || 6), costV = Math.round(durV * OMNI_FLASH_SEC) + (params.product === true ? OMNI_START_IMG : 0)
      // PRODUIT (Axel 01/10) : photo officielle = lien produit lu ici, OU photo déposée dans la carte → référence de la photo de départ
      if (params.product === true) {
        let refP: { bytes: Uint8Array; contentType: string } | null = null
        const mP = /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url || ''))
        if (mP) { const bP = b64ToBytes(mP[3]); if (bP.length > 10_000_000) return json(413, { error: 'too_large' }); refP = { bytes: bP, contentType: mP[1] } }
        else if (/^https?:\/\//i.test(String(body.product_url || ''))) {
          try { const iu = await extraireImageProduit(String(body.product_url)); if (iu) { const g = await fetchUserFile(iu, 10_000_000, /^image\/(png|jpe?g|webp)$/, 'la photo du produit'); if (typeof g !== 'string') refP = g } } catch (_) { /* bloqué */ }
          if (!refP) return json(422, { error: 'no_image_in_link' })
        } else return json(400, { error: 'bad_image' })
        if (!isUnlimited(profV)) {
          const capP = DAILY_CAPS[String(profV.plan || '').toLowerCase()] ?? 100
          const { data: capRP } = MCP_CAP_ON ? await svc.rpc('mcp_cap_reserve', { p_user: userIdV, p_cost: Math.max(0, costV - (Number(params.cap_held) || 0)), p_cap: capP }) : { data: null }   // part déjà réservée à la création de la carte : jamais comptée deux fois (02/10)
          if (typeof capRP === 'number' && capRP < 0) return json(429, { error: 'daily_cap' })
          if ((Number(profV.credits_remaining) || 0) < costV) return json(402, { error: 'no_credits' })
        }
        const nowP = new Date().toISOString()
        const { data: tookP } = await svc.from('mcp_jobs').update({ status: 'running', credits_cost: 0, created_at: nowP, updated_at: nowP })
          .eq('id', jobId).eq('status', 'pending').select('id')
        if (!tookP || !tookP.length) return json(409, { error: 'not_pending' })
        runOmniFlashJob({ userId: userIdV, jobId, cost: costV, imageUrl: '', aspect: params.aspect === '16:9' ? '16:9' : '9:16', duration: durV,
          prompt: expressOmniPrompt(String(params.prompt || '')), genImage: augmenterPortrait(expressImagePrompt(String(params.prompt || ''))), productRef: refP })
        return json(200, { job_id: jobId, statusUrl: `https://mcp.avatarads.fr/status/${jobId}` })
      }
      const mV = /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url || ''))
      if (!mV) return json(400, { error: 'bad_image' })
      const bytesV = b64ToBytes(mV[3])
      if (bytesV.length > 10_000_000) return json(413, { error: 'too_large' })
      if (!isUnlimited(profV)) {
        const capV = DAILY_CAPS[String(profV.plan || '').toLowerCase()] ?? 100
        const { data: capRV } = MCP_CAP_ON ? await svc.rpc('mcp_cap_reserve', { p_user: userIdV, p_cost: Math.max(0, costV - (Number(params.cap_held) || 0)), p_cap: capV }) : { data: null }   // part déjà réservée à la création de la carte : jamais comptée deux fois (02/10)
        if (typeof capRV === 'number' && capRV < 0) return json(429, { error: 'daily_cap' })
        if ((Number(profV.credits_remaining) || 0) < costV) return json(402, { error: 'no_credits' })
      }
      const extV = mV[2] === 'png' ? 'png' : mV[2] === 'webp' ? 'webp' : 'jpg'
      const pathV = `${userIdV}/ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extV}`
      const { error: upV } = await svc.storage.from('mcp-media').upload(pathV, bytesV, { contentType: mV[1] })
      if (upV) return json(500, { error: 'upload' })
      const urlV = (await signPath(pathV, 6 * 3600)) || `${MEDIA_PUB}${pathV}`
      const nowV = new Date().toISOString()
      const { data: tookV } = await svc.from('mcp_jobs').update({ status: 'running', credits_cost: 0, created_at: nowV, updated_at: nowV })
        .eq('id', jobId).eq('status', 'pending').select('id')
      if (!tookV || !tookV.length) return json(409, { error: 'not_pending' })
      runOmniFlashJob({ userId: userIdV, jobId, cost: costV, imageUrl: urlV, aspect: params.aspect === '16:9' ? '16:9' : '9:16', duration: durV,
        prompt: expressOmniPrompt(String(params.prompt || '')) })
      return json(200, { job_id: jobId, statusUrl: `https://mcp.avatarads.fr/status/${jobId}` })
    }
    const pArgs = (params.args || {}) as Record<string, unknown>
    const format = ['portrait', 'square', 'landscape'].includes(String(params.format)) ? String(params.format) : 'portrait'
    const quality: ImgQ = (['low', 'standard', 'high'] as string[]).includes(String(params.quality)) ? params.quality as ImgQ : 'standard'
    const kind = String(params.kind || 'free')
    const userId = String(pj.user_id)
    const { data: profile } = await svc.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (!profile) return json(404, { error: 'no_profile' })
    if (!isUnlimited(profile) && !ALLOWED_PLANS.includes(String(profile.plan || '').toLowerCase())) return json(403, { error: 'plan' })
    const cost = IMG_COST[quality]
    if (!isUnlimited(profile)) {
      const cap = DAILY_CAPS[String(profile.plan || '').toLowerCase()] ?? 100
      const { data: capR } = MCP_CAP_ON ? await svc.rpc('mcp_cap_reserve', { p_user: userId, p_cost: Math.max(0, cost - (Number(params.cap_held) || 0)), p_cap: cap }) : { data: null }   // F1 : plafond atomique — part déjà réservée à la création de la carte non recomptée (02/10)
      if (typeof capR === 'number' && capR < 0) return json(429, { error: 'daily_cap' })
      if ((Number(profile.credits_remaining) || 0) < cost) return json(402, { error: 'no_credits' })
    }
    // photo déposée dans la carte → mcp-media (privé, ref-…) → référence de l'édition
    let ref: { bytes: Uint8Array; contentType: string } | null = null
    let refUrl = ''
    const linkUrl = String(body.product_url || '').trim()
    if (!body.skip && linkUrl) {
      const got = await referenceDepuisLien(linkUrl)
      if (!got.ref) return json(422, { error: 'no_image_in_link' })
      ref = got.ref; refUrl = got.url
    } else if (!body.skip) {
      const m = /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url || ''))
      if (!m) return json(400, { error: 'bad_image' })
      const bytes = b64ToBytes(m[3])
      if (bytes.length > 10_000_000) return json(413, { error: 'too_large' })
      const ext = m[2] === 'png' ? 'png' : m[2] === 'webp' ? 'webp' : 'jpg'
      const path = `${userId}/ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error: upErr } = await svc.storage.from('mcp-media').upload(path, bytes, { contentType: m[1] })
      if (upErr) return json(500, { error: 'upload' })
      refUrl = (await signPath(path, 7 * 86400)) || `${MEDIA_PUB}${path}`   // mcp-media privé (audit 28/09)
      ref = { bytes, contentType: m[1] }
    }
    // pending → running, atomique (deux clics = un seul lancement). credits_cost = 0 jusqu'au débit : mcp_spend_for_job
    // débite ET pose credits_cost dans la même transaction (relecture 26/09) → un filet ne rend jamais un débit absent.
    // Audit 28/09 (HAUTE) : created_at REMIS à maintenant — les filets (8 / 20 min) lisent created_at ; une carte vieille de
    // 2 h passait running avec un created_at ancien → remboursée par le filet pendant que l'image était livrée (refund-and-keep).
    const _nowIso = new Date().toISOString()
    const { data: took } = await svc.from('mcp_jobs').update({ status: 'running', credits_cost: 0, created_at: _nowIso, updated_at: _nowIso })
      .eq('id', jobId).eq('status', 'pending').select('id')
    if (!took || !took.length) return json(409, { error: 'not_pending' })
    const bal = await spendForJob(userId, jobId, cost)
    if (bal === -2) return json(409, { error: 'not_pending' })
    if (bal === null || bal === -1) { await failAndRefund(userId, { id: jobId }, 'crédits'); return json(402, { error: 'credits' }) }   // rend SEULEMENT un débit réellement posé
    const size = ({ portrait: '1152x2048', square: '1024x1024', landscape: '1536x1024' } as Record<string, string>)[format]
    // #static-ads-bank : le format mémorisé à la création (ad_format = id) est repris tel quel → même mise en page
    const pFmt = STATIC_AD_FORMATS.find((f) => f.id === String((pArgs as Record<string, unknown>).ad_format || '')) || null
    const promptFinal = composerPromptImage({ ...(pArgs as Record<string, unknown>), __adFormat: pFmt }, !!ref)
    bg((async () => {
      let lastErr = 'Erreur génération'
      try {
        const out = await genererImage(promptFinal, size, quality, ref)
        if ('bytes' in out) {
          const brut = out.bytes
          const url = await uploadMedia(userId, brut, 'png', 'image/png')
          let apercu: string | null = null
          try { const petit = await fabriquerApercu(brut); if (petit) apercu = await uploadMedia(userId, petit, 'jpg', 'image/jpeg') } catch (_) { /* vignette = confort */ }
          // Audit 28/09 : livraison CONDITIONNELLE (job encore 'running' et non remboursé) — sinon un filet l'a déjà rendu : pas de livraison.
          const { data: _ok } = await svc.from('mcp_jobs').update({ status: 'done', result_url: url, preview_url: apercu, updated_at: new Date().toISOString() }).eq('id', jobId).eq('status', 'running').eq('refunded', false).select('id')
          if (!_ok || !_ok.length) return
          await saveToLibrary(userId, brut, 'png', 'image/png', 'image', kind === 'static_ad' ? 'Static ad' : 'Image IA', apercu || url)
          return
        }
        lastErr = out.error
      } catch (e) { lastErr = String((e as Error)?.message || e) }
      await failAndRefund(userId, { id: jobId, credits_cost: cost }, lastErr.slice(0, 300))   // audit 28/09 : idempotent — jamais un 2e remboursement après un filet
    })())
    return json(200, { job_id: jobId, statusUrl: `https://mcp.avatarads.fr/status/${jobId}`, ref: refUrl, prompt: promptFinal })
  }

  // Regénérer EN UN CLIC depuis le widget (la spec MCP Apps interdit au widget
  // d'appeler un outil ; ui/message passe par la barre). Ici le widget tape cet
  // endpoint : le job_id d'origine = CAPACITÉ → user_id. Mêmes garde-fous que
  // l'outil (plan Pro/Élite, plafond 24 h, crédits) + fraîcheur ≤12 h (un job_id
  // fuité ne peut pas être rejoué indéfiniment). Toujours STANDARD (3 cr).
  if (segs[1] === 'regenerate' && req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const origId = String(body.job || '')
    const prompt = String(body.prompt || '').trim()
    const format = ['portrait', 'square', 'landscape'].includes(String(body.format)) ? String(body.format) : 'portrait'
    const refUrl = String(body.ref || '').trim()
    const raw = body.raw === true || body.raw === 'true'   // prompt déjà composé par generate_image → ne pas le ré-augmenter
    if (!/^[0-9a-f-]{36}$/i.test(origId) || !prompt) return json(400, { error: 'bad_request' })
    if (!(await capOk(origId, body.cap))) return json(403, { error: 'forbidden' })   // capacité signée (H4) : un job_id fuité ne suffit plus — vérifiée AVANT toute lecture (audit 02/10)
    const { data: orig } = await svc.from('mcp_jobs').select('user_id, created_at, params, kind').eq('id', origId).maybeSingle()
    // audit 02/10 : la capacité d'un job VIDÉO / montage / lipsync ne régénère pas d'image (le bouton n'existe que sur une image)
    if (!orig || orig.kind !== 'image') return json(404, { error: 'not_found' })
    // audit 02/10 : 30 régénérations par heure et par compte au plus (le plafond 24 h est désactivé, il ne bornait plus ce chemin)
    if (!(await rateHit('mcp-regen:' + String(orig.user_id), 3600, 30))) return json(429, { error: 'busy' })
    // F2 (audit MCP 14/09) : fraîcheur ancrée à la RACINE, pas au parent chaînable. Un job régénéré hérite du root_ts ;
    // ré-générer en boucle ne réarme donc plus la fenêtre 12 h (avant : chaque nouveau job avait created_at=now →
    // chaîne /regenerate auto-entretenue = spend indéfini sur une capacité fuitée). Après 12 h depuis le job d'ORIGINE → expiré.
    const _rootTs = ((orig.params as Record<string, unknown> | null)?.root_ts)
      ? new Date(String((orig.params as Record<string, unknown>).root_ts)).getTime()
      : new Date(String(orig.created_at)).getTime()
    if (Date.now() - _rootTs > 12 * 3600 * 1000) return json(403, { error: 'expired' })
    const userId = String(orig.user_id)
    const { data: profile } = await svc.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (!profile) return json(404, { error: 'no_profile' })
    if (!isUnlimited(profile) && !ALLOWED_PLANS.includes(String(profile.plan || '').toLowerCase())) return json(403, { error: 'plan' })
    const cost = IMG_COST.standard
    if (!isUnlimited(profile)) {
      const cap = DAILY_CAPS[String(profile.plan || '').toLowerCase()] ?? 100
      const { data: capR } = MCP_CAP_ON ? await svc.rpc('mcp_cap_reserve', { p_user: userId, p_cost: cost, p_cap: cap }) : { data: null }   // F1 : plafond atomique
      if (typeof capR === 'number' && capR < 0) return json(429, { error: 'daily_cap' })
      if ((Number(profile.credits_remaining) || 0) < cost) return json(402, { error: 'no_credits' })
    }
    const bal = await spendCredits(userId, cost)
    if (bal === null || bal === -1) return json(402, { error: 'credits' })
    const size = ({ portrait: '1152x2048', square: '1024x1024', landscape: '1536x1024' } as Record<string, string>)[format]
    // F2 : le job régénéré porte le root_ts → la fraîcheur de la PROCHAINE régénération reste ancrée à la racine.
    const { data: job, error: jErr } = await svc.from('mcp_jobs').insert({ user_id: userId, kind: 'image', status: 'running', credits_cost: cost, params: { root_ts: new Date(_rootTs).toISOString() } }).select('id').single()
    if (jErr || !job) { await refundCredits(userId, cost); return json(500, { error: 'job' }) }
    bg((async () => {
      let lastErr = 'Erreur génération'
      try {
        let ref: { bytes: Uint8Array; contentType: string } | null = null
        if (refUrl) { const got = await fetchUserFile(refUrl, 10_000_000, /^image\/(png|jpe?g|webp)$/, 'la photo de référence'); if (typeof got !== 'string') ref = got }
        const out = await genererImage(raw ? prompt : augmenterPortrait(prompt), size, 'standard', ref)
        if ('bytes' in out) {
          const brut = out.bytes
          const url = await uploadMedia(userId, brut, 'png', 'image/png')
          let apercu: string | null = null
          try { const petit = await fabriquerApercu(brut); if (petit) apercu = await uploadMedia(userId, petit, 'jpg', 'image/jpeg') } catch (_) { /* vignette = confort */ }
          // Audit 28/09 : livraison CONDITIONNELLE (job encore 'running' et non remboursé) — sinon un filet l'a déjà rendu : pas de livraison.
          const { data: _ok } = await svc.from('mcp_jobs').update({ status: 'done', result_url: url, preview_url: apercu, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'running').eq('refunded', false).select('id')
          if (!_ok || !_ok.length) return
          await saveToLibrary(userId, brut, 'png', 'image/png', 'image', 'Image IA', apercu || url)  // filet Bibliothèque (regénération)
          return
        }
        lastErr = out.error
      } catch (e) { lastErr = String((e as Error)?.message || e) }
      await failAndRefund(userId, { id: job.id, credits_cost: cost }, lastErr.slice(0, 300))   // audit 28/09 : idempotent — jamais un 2e remboursement après un filet
    })())
    return json(200, { job_id: job.id, cap: await jobCap(job.id), statusUrl: `https://mcp.avatarads.fr/status/${job.id}` })
  }

  // JS du widget MCP App, servi hors sandbox (comme Pletor sert le sien depuis
  // son API) : c'est CE fichier que l'iframe charge en <script src>, car le CSP
  // de la sandbox bloque tout JS inline.
  if (segs[1] === 'widget.js') {
    return new Response(UI_WIDGET_JS, { headers: { ...cors,
      'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } })
  }

  // Icône du connecteur en PLEIN BORD (fond sombre jusqu'aux coins). La favicon.svg
  // et le PNG du site ont les COINS TRANSPARENTS → claude.ai laissait transparaître son
  // fond blanc aux angles de l'avatar (arrondi par l'hôte). Ici le carré est PLEIN → une
  // fois arrondi par claude, coins nets, plus de blanc. Servie par la fonction (aucun
  // redeploy du site) et pointée par serverInfo.icons.
  // favicon.* et apple-touch-icon sur le domaine du connecteur : claude.ai (et d'autres clients) vont
  // chercher la favicon du DOMAINE — ici le catch-all MCP répondait un flux text/event-stream, d'où le
  // repli sur la favicon du site (coins transparents → angles blancs dans Claude, Axel 21/08).
  if (segs.length === 2 && /^(favicon\.(ico|png)|apple-touch-icon(-precomposed)?\.png|icon-(\d+)\.png)$/.test(segs[1])) {
    return new Response(b64ToBytes(ICON_PNG_B64) as unknown as BodyInit, { headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } })
  }
  if (segs[1] === 'icon.svg' || segs[1] === 'favicon.svg') {
    return new Response(
      '<svg viewBox="0 0 36 36" width="36" height="36" xmlns="http://www.w3.org/2000/svg"><rect width="36" height="36" fill="#0a0a0a"/><path fill-rule="evenodd" fill="white" d="M18 8C14.5 8 2.5 11.5 2.5 18.5C2.5 23.5 7 27.5 13 27.5C15.8 27.5 17.3 25 18 23.8C18.7 25 20.2 27.5 23 27.5C29 27.5 33.5 23.5 33.5 18.5C33.5 11.5 21.5 8 18 8ZM7.5 18.5C7.5 16.2 9.5 14.5 12 14.5C14.5 14.5 16.5 16.2 16.5 18.5C16.5 20.8 14.5 22.5 12 22.5C9.5 22.5 7.5 20.8 7.5 18.5ZM19.5 18.5C19.5 16.2 21.5 14.5 24 14.5C26.5 14.5 28.5 16.2 28.5 18.5C28.5 20.8 26.5 22.5 24 22.5C21.5 22.5 19.5 20.8 19.5 18.5Z"/></svg>',
      { headers: { ...cors, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
  }

  if (segs[1] === 'key') {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    return await handleKeyManagement(req)
  }
  // Photo PRODUIT pour Claude (20/08) : claude.ai ne transmet pas les images jointes aux outils →
  // l'utilisateur la dépose ici (app, JWT) ; on la range dans mcp-media/<uid>/ref-<stamp>.<ext>
  // (public) → URL à donner à Claude, et list_media la retrouve (nom ref-…).
  if (segs[1] === 'ref' && req.method === 'POST') {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!token) return json(401, { error: 'unauthorized' })
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error } = await userClient.auth.getUser()
    if (error || !user) return json(401, { error: 'unauthorized' })
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return json(400, { error: 'bad_request' }) }
    // Audit 28/09 (moyenne) : dépôt réservé aux plans qui peuvent générer (Free exclu), 30 / h par compte, et type lu dans
    // les OCTETS (PNG / JPEG / WebP) — jamais celui annoncé par le client (le bucket mcp-media est public).
    const { data: prof } = await svc.from('profiles').select('plan, is_owner').eq('id', user.id).maybeSingle()
    const refPlan = String(prof?.plan || '').toLowerCase()
    if (!prof?.is_owner && refPlan !== 'developer' && !ALLOWED_PLANS.includes(refPlan)) return json(403, { error: 'plan' })
    if (!(await rateHit('mcp-ref:' + user.id, 3600, 30))) return json(429, { error: 'rate_limited' })
    const m = /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url || ''))
    if (!m) return json(400, { error: 'bad_image' })
    const bytes = b64ToBytes(m[3])
    if (bytes.length > 10_000_000) return json(413, { error: 'too_large' })
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    const isJpg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const isWebp = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
    if (!isPng && !isJpg && !isWebp) return json(400, { error: 'bad_image' })
    const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg'
    const refMime = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg'
    const path = `${user.id}/ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
    const { error: upErr } = await svc.storage.from('mcp-media').upload(path, bytes, { contentType: refMime })
    if (upErr) return json(500, { error: 'upload' })
    return json(200, { ok: true, url: (await signPath(path, 7 * 86400)) || `${MEDIA_PUB}${path}` })   // mcp-media privé : lien signé 7 jours
  }
  // Routes OAuth (.well-known, register, authorize, oauth/approve, token)
  const repOAuth = await handleOAuth(req, url, segs)
  if (repOAuth) return repOAuth

  // ── Découverte OAuth : on répond 404, PAS 405 ──
  // Les connecteurs claude.ai sondent /.well-known/oauth-* avant de parler MCP.
  // Un 405 (« méthode non autorisée ») laisse croire que la ressource EXISTE :
  // le client enchaîne alors sur l'inscription dynamique (RFC 7591) et échoue
  // avec « Impossible de s'inscrire auprès du service de connexion ». Un 404
  // dit clairement « pas d'OAuth ici » → le client accepte l'URL à clé.
  if (url.pathname.includes('/.well-known/')) {
    return new Response(JSON.stringify({ error: 'not_found' }),
      { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } })
  }

  // Streamable HTTP sans état : pas de flux SSE côté GET
  // GET = ouverture d'un flux SSE serveur→client. On n'en émet aucun (transport
  // sans état), mais on répond 200 avec un flux vide plutôt qu'un 405 : côté
  // claude.ai, un 405 fait apparaître le connecteur comme injoignable.
  if (req.method === 'GET') {
    // Keep-warm (worker Railway, GET toutes les 4 min) → réconciliation globale des jobs vidéo,
    // INDÉPENDANTE du proxy connecteur/widget. Throttle 2 min pour ne pas la lancer sur chaque
    // sonde SSE de claude. Date.now() est OK ici (fonction edge normale, pas un script workflow).
    // Audit 28/09 #32 : réservée au GET du cron mcp-keepwarm (x-cron-key = CRON_SECRET) — un GET anonyme ne déclenche
    // plus de sondes fournisseurs ni de téléchargements pour tous les comptes.
    const _now = Date.now()
    const _cron = !!CRON_SECRET && timingSafeEqual(req.headers.get('x-cron-key') || '', CRON_SECRET)
    if (_cron && _now - _lastReconcile > 120_000) { _lastReconcile = _now; bg(reconcileAllStale()) }
    // GET ANONYME → 401 + WWW-Authenticate (29/08). Le nouvel écran claude.ai
    // « vérification du serveur » sonde l'URL nue ; un 200 ici contredisait le
    // 401 du POST (claude.ai n'honore JAMAIS WWW-Authenticate sur un 200) →
    // « Impossible de vérifier ». Le 401 est le signal spec (RFC 9728 §5.1).
    // Les GET AVEC identifiant (clé aa_ dans le chemin/query, ou Bearer aat_)
    // gardent le flux SSE vide — keep-warm Railway (GET nu, statut ignoré) OK.
    const gAuth = (req.headers.get('Authorization') || '').trim()
    const gKey = segs[1] || url.searchParams.get('key') || ''
    if (!gAuth && !gKey.startsWith('aa_')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors,
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${oauthBase(req)}/.well-known/oauth-protected-resource"` } })
    }
    return new Response(': ok\n\n', {
      status: 200,
      headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  // ── JAMAIS DE 401 ICI ──────────────────────────────────────────────────────
  // Le 401 est LE signal, dans la spec MCP, qui dit « ce serveur est protégé par
  // OAuth ». Le client enchaîne alors sur la découverte puis sur l'inscription
  // dynamique (RFC 7591) — et comme nous n'avons pas d'OAuth (la clé est dans
  // l'URL), ça échoue avec « Impossible de s'inscrire auprès du service de
  // connexion de AvatarAds ». Axel : « il fonctionne mais je n'arrive pas à le
  // connecter dans Claude » — le serveur répondait bien, c'est le 401 sur les
  // sondes SANS clé (claude.ai interroge aussi l'URL nue) qui déclenchait tout.
  //
  // En JSON-RPC, une erreur se transporte DANS LE CORPS, pas dans le statut
  // HTTP. On répond donc 200 avec un objet `error` : le client lit le message,
  // et aucun client ne part en OAuth.
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
  const key = segs[1] || url.searchParams.get('key') || (bearer.startsWith('aa_') ? bearer : '')
  // ── UNE CLÉ MORTE NE BLOQUE PLUS LA CONNEXION (Axel, 15/08) ────────────────
  // Quand initialize échouait sur clé révoquée, claude.ai affichait
  // « Impossible de joindre » → l'utilisateur régénérait → ce qui révoquait la
  // clé de ses AUTRES connecteurs → boucle infernale. Désormais initialize,
  // tools/list et resources répondent TOUJOURS (rien de sensible dedans), et
  // l'erreur claire tombe à l'APPEL d'outil, avec la marche à suivre.
  let keyErr: string | null = null
  // deno-lint-ignore no-explicit-any
  let keyRow: any = null
  // ── jeton OAuth (aat_…) : équivalent d'une clé, mappé au compte ──
  if (bearer.startsWith('aat_')) {
    const { data: tok } = await svc.from('mcp_oauth_tokens').select('token_hash, user_id, expires_at')
      .eq('token_hash', await hashKey(bearer)).maybeSingle()
    if (!tok) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: { ...cors,
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${oauthBase(req)}/.well-known/oauth-protected-resource", error="invalid_token"` } })
    }
    if (new Date(String(tok.expires_at)).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'expiré' }), { status: 401, headers: { ...cors,
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${oauthBase(req)}/.well-known/oauth-protected-resource", error="invalid_token"` } })
    }
    bg((async () => { await svc.from('mcp_oauth_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', tok.token_hash) })())
    keyRow = { id: null, user_id: tok.user_id, require_confirm: true }   // audit 05/09 : confirmation avant toute dépense, par défaut
  } else if (!key || !key.startsWith('aa_')) {
    // AUCUN identifiant : 401 + WWW-Authenticate → claude.ai découvre l'OAuth
    // et lance « Se connecter avec AvatarAds ». (Les URLs à clé ne passent
    // jamais ici : la clé est dans le chemin.)
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors,
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${oauthBase(req)}/.well-known/oauth-protected-resource"` } })
  } else if (KEY_MODE_OFF) {
    // Axel 02/10 : ancien mode « clé dans l'URL » COUPÉ (3 clés restantes révoquées, inutilisées depuis le 24/08) → OAuth seul
    keyErr = 'Ce lien de connexion n’est plus valable : AvatarAds se connecte désormais à Claude via OAuth. Retire ce connecteur et ajoute https://mcp.avatarads.fr (bouton « Relier à Claude » sur ' + APP_URL + ').'
  } else {
    const { data } = await svc.from('mcp_keys').select('id, user_id, require_confirm')
      .eq('key_hash', await hashKey(key)).is('revoked_at', null).maybeSingle()
    keyRow = data
    if (!keyRow) keyErr = 'Clé AvatarAds invalide ou révoquée. Va dans Mon compte sur ' + APP_URL + ', copie l’URL de la clé ACTUELLE et remplace l’URL de ce connecteur (ne régénère pas : ça révoque la clé partout ailleurs).'
  }
  if (keyRow && keyRow.id) bg((async () => { await svc.from('mcp_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id) })())

  // deno-lint-ignore no-explicit-any
  let profile: any = null
  if (keyRow) {
    const { data } = await svc.from('profiles').select(
      'id, email, first_name, plan, credits_remaining, is_owner',
    ).eq('id', keyRow.user_id).maybeSingle()
    profile = data
    if (!profile) keyErr = 'Compte introuvable.'
  }

  // Accès réservé Pro/Élite (clé créée puis plan rétrogradé → on bloque à l'usage aussi)
  const planKey = String(profile?.plan || '').toLowerCase()
  const planAllowed = profile ? (isUnlimited(profile) || ALLOWED_PLANS.includes(planKey)) : false
  const ctx: ToolCtx = {
    requireConfirm: false,   // Axel 01/10 : PLUS de devis ni d'accord demandé avant une génération ; 02/10 : plus de plafond 24 h non plus (MCP_CAP_ON)
    dailyCap: !MCP_CAP_ON || (profile && isUnlimited(profile)) ? null : (DAILY_CAPS[planKey] ?? 100),
  }

  let msg: Record<string, unknown>
  try { msg = await req.json() } catch { return rpcError(null, -32700, 'Parse error') }
  if (Array.isArray(msg)) return rpcError(null, -32600, 'Batch non supporté')
  const id = 'id' in msg ? msg.id : undefined
  const method = String(msg.method || '')
  const params = (msg.params || {}) as Record<string, unknown>
  console.log('[mcp]', method || '(sans méthode)', '· id:', String(id), '· ua:', (req.headers.get('user-agent') || '?').slice(0, 40), keyErr ? '· keyErr' : '')

  // Notifications (pas d'id) → accusé de réception sans corps
  if (id === undefined) return new Response(null, { status: 202, headers: cors })

  try {
    if (method === 'initialize') {
      const requested = String(params.protocolVersion || '')
      const supported = ['2025-06-18', '2025-03-26', '2024-11-05']
      return rpcResult(id, {
        protocolVersion: supported.includes(requested) ? requested : '2025-06-18',
        // 16/08 14h : widget RÉ-ACTIVÉ avec le VRAI fix — la console d'Axel a montré
        // que claude.ai BLOQUE le JS inline (CSP script-src sans 'unsafe-inline'). Le
        // JS passe maintenant en EXTERNE (/widget.js, WIDGET_ORIGIN dans resourceDomains
        // → script-src). capability `resources` + `_meta.ui.resourceUri` (.html) sur les
        // check_* → claude.ai fetch resources/read + rend le widget inline.
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        // `title`, `websiteUrl` et `icons` : ce que les clients MCP affichent
        // dans leur liste de connecteurs (logo + nom lisible au lieu d'un « A »)
        serverInfo: {
          name: 'AvatarAds',
          title: 'AvatarAds',
          version: '1.4.1',
          websiteUrl: 'https://avatarads.fr',
          icons: [
            // Icône PLEIN BORD servie par la fonction (coins sombres jusqu'au bord) : la
            // favicon.svg/PNG du site ont les coins TRANSPARENTS → claude affichait son fond
            // blanc aux angles de l'avatar. Voir la route /icon.svg.
            { src: 'https://mcp.avatarads.fr/icon.svg?v=2', mimeType: 'image/svg+xml', sizes: ['any'] },
            { src: 'https://mcp.avatarads.fr/icon-256.png?v=2', mimeType: 'image/png', sizes: ['256x256'] },
          ],
        },
        instructions: "⛔ MODE SILENCIEUX ABSOLU (priorité n°1, avant tout le reste) : pour une demande de visuel/static ad/UGC, ta réponse ne contient QUE des appels generate_image et ZÉRO texte — pas une phrase avant, pas une phrase après, pas de préambule, pas de récap, pas de liste d'angles, pas de « je lance », pas de script, pas de question, pas d'emoji. 🎬 DEMANDE DE VIDÉO (même avec un lien ou une photo de produit) : UN SEUL appel generate_video — avec product_url pour un lien produit — JAMAIS generate_image avant : la photo de départ puis la vidéo s'enchaînent toutes seules dans la même carte. Ne CONSULTE PAS la page toi-même (pas de web fetch / recherche) : passe l'URL du produit DIRECTEMENT dans product_url — l'outil récupère la photo et génère. Compose headline/subheadline/bullets/brand/cta toi-même de façon concise SANS les écrire dans le chat. Pour PLUSIEURS visuels : un appel APRÈS l'autre (jamais en parallèle). La carte affiche tout ; l'utilisateur ne veut RIEN lire d'autre. PHOTO PRODUIT (ordre de préférence) : (1) si tu as consulté la page produit et vois l'URL de l'image principale (og:image, souvent cdn.shopify.com) → reference_image_url (fiable même si la page bloque notre serveur) ; (2) l'utilisateur colle le lien de page → product_url (extraction auto + repli dépôt) ; (3) rien → appelle quand même generate_image (kind static_ad/ugc), la carte gère. Jamais de questions en rafale. STATIC AD : utilise kind:'static_ad' avec headline/subheadline/bullets/brand/cta en français. ⚡ VIDÉO UGC — une personne qui PRÉSENTE / PARLE à partir d'une PHOTO (ou une « vidéo UGC », « vidéo qui présente », « avatar qui parle ») : utilise TOUJOURS generate_video (Express) avec un prompt style UGC RÉEL (selfie authentique tenu à bout de bras, la personne parle face caméra d'un ton naturel et improvise sa présentation du produit ; enchaîne les phrases, pas de « euh »). Durée 4-10 s, aspect 9:16 par défaut. 📷 LA PHOTO : claude.ai ne te transmet PAS les images jointes au chat — tu n'as JAMAIS accès à la photo déposée dans la conversation. Si l'utilisateur a JOINT une ou plusieurs photos et veut en faire des vidéos : appelle generate_video avec user_photo:true, UN appel par vidéo, sans image_url — la carte lui fait déposer sa photo et lance la vidéo toute seule. Ne l'envoie JAMAIS sur le site et ne lui demande pas de lien. Tarif : 5 crédits/seconde (4, 6, 8 ou 10 s) ; sans aucune image, +3 crédits pour la photo de départ générée. Annonce le BON tarif. C'est LE SEUL et LE BON outil pour une vidéo d'une personne qui parle — il n'y a pas d'outil « générateur d'avatar » ici (ça reste manuel sur le site). ⛔ Ne nomme JAMAIS le moteur technique sous-jacent (dis « le module Express d'AvatarAds »). Serveur MCP AvatarAds (avatarads.fr) — les modules de l'app pilotés depuis Claude : Images IA = generate_image · Express = generate_video puis check_video (⚡ le SEUL outil pour une VIDÉO d'une personne — voir la règle UGC ci-dessous) · Omni (modifier une vidéo existante par un prompt) = edit_video · Motion Control (une photo reproduit les mouvements d'une vidéo de référence) = motion_control — pour ces deux-là, appelle l'outil SANS fichier : la carte fait déposer la vidéo (et la photo) ; et si l'utilisateur n'a pas précisé la qualité (et le modèle pour motion_control), pose d'abord UNE question courte sur la qualité — JAMAIS sur la durée (tu ne vois pas la vidéo : la carte prévient si elle est trop longue) — c'est la SEULE question permise, le mode silencieux ne s'applique pas à elle · Nettoyage audio = clean_audio · MONTAGE IA (audio → vidéo motion-design complète) = montage_ia puis check_montage · Éditeur = get_montage_plan (lire le plan) et render_montage_plan (re-rendre le plan modifié). Tout consomme les crédits du compte connecté. ⚠️ RÉCUPÉRATION AUTOMATIQUE (TRÈS IMPORTANT) : « Impossible de joindre AvatarAds », « Connecteur inconnu », « Connecteur introuvable », « le serveur n'a pas répondu » ou une erreur 502 sur generate_* = le RELAIS de claude.ai a lâché (souvent avant même d'atteindre le serveur) — ce n'est ni une panne du serveur ni la preuve que la génération a démarré. Fais alors, dans le MÊME tour et sans rien demander : (1) UN seul nouvel appel du MÊME outil generate_* ; (2) si ça échoue encore, appelle check_video / check_image SANS aucun argument — ça retrouve et affiche la dernière génération du compte si elle a bien été créée (c'est CE rappel qui fait apparaître la carte), sinon ça répond clairement qu'il n'y a rien. Si aucune carte ne s'affiche après ça, DIS-LE en une phrase (« le relais de claude.ai a coupé, rien n'a été lancé ») — n'écris JAMAIS « ton visuel est en cours dans la carte ci-dessus » sans un résultat d'outil reçu dans ce tour. Quand un résultat est reçu mais que la carte ne s'affiche pas, donne le lien de téléchargement présent dans le résultat (https://mcp.avatarads.fr/i/<job_id>). Ne relance JAMAIS generate plus d'une fois (2ᵉ débit)." + (ctx.requireConfirm
          ? "Avant toute génération, un devis en crédits peut être retourné : montre-le à l'utilisateur et attends son accord avant de rappeler l'outil avec confirm: true. "
          : "L'utilisateur a DÉSACTIVÉ la demande de confirmation : lance les générations directement, sans demander son accord ni annoncer le coût au préalable. ") + "get_account donne le solde.",
      })
    }
    if (method === 'ping') return rpcResult(id, {})
    if (method === 'tools/list') return rpcResult(id, { tools: toolDefs(profile ? isUnlimited(profile) : false, ctx.requireConfirm, profile?.is_owner === true) })
    // ── server/discover (01/09) : le client d'INTERFACE de claude.ai (UA « Claude-User »)
    // utilise CETTE méthode — hors spec MCP standard — pour peupler la carte du connecteur.
    // Constat sur les logs : quand Claude prend cette branche, il reçoit notre -32601 puis
    // BOUCLE sur server/discover + initialize et n'appelle JAMAIS tools/list → « ce connecteur
    // n'a aucun outil disponible » (bug client claude #1716 : les deux clients ne partagent pas
    // leur découverte). Un connecteur qui marche (pletor) répond -32601 et SON Claude retombe
    // sur tools/list — mais ce repli n'est pas fiable chez nous. On répond donc DIRECTEMENT le
    // descriptif du serveur + les outils, quelle que soit la branche prise par le client.
    // La forme exacte n'étant pas documentée, on log les params reçus pour affiner au besoin.
    if (method === 'server/discover') {
      console.log('[mcp] server/discover · params:', JSON.stringify(params).slice(0, 300))
      return rpcResult(id, {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
        serverInfo: { name: 'AvatarAds', title: 'AvatarAds', version: '1.4.1', websiteUrl: 'https://avatarads.fr' },
        tools: toolDefs(profile ? isUnlimited(profile) : false, ctx.requireConfirm, profile?.is_owner === true),
        resources: UI_RESOURCES,
        prompts: [],
      })
    }
    if (method === 'resources/list') return rpcResult(id, { resources: UI_RESOURCES })
    if (method === 'resources/templates/list') return rpcResult(id, { resourceTemplates: [] })
    if (method === 'resources/read') {
      const uri = String(params?.uri || '')
      if (uri.startsWith('ui://avatarads/')) {
        return rpcResult(id, { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: UI_VIEWER_HTML, _meta: UI_META }] })
      }
      return rpcError(id, -32002, 'Ressource inconnue : ' + uri)
    }
    if (method === 'prompts/list') return rpcResult(id, { prompts: [] })
    if (method === 'tools/call') {
      if (keyErr || !profile) {
        return rpcResult(id, { content: [{ type: 'text', text: keyErr || 'Compte introuvable.' }], isError: true })
      }
      const name = String(params.name || '')
      const args = (params.arguments || {}) as Record<string, unknown>
      if (!planAllowed) {
        return rpcResult(id, toolErr(`L'accès via Claude est réservé aux plans Starter, Pro et Élite. Ton plan actuel : ${profile.plan || 'free'}. Passe au plan supérieur sur ${APP_URL}`))
      }
      // Rattrapage en arrière-plan des vidéos bloquées (débits sans contrepartie) — n'ajoute pas de latence
      if (!isUnlimited(profile)) bg(reconcileStaleJobs(String(profile.id)))
      let out: ToolContent
      if (name === 'get_account') out = await runGetAccount(profile)
      else if (name === 'generate_image') out = await runGenerateImage(profile, args, ctx)
      else if (name === 'generate_video') out = await runGenerateVideo(profile, args, ctx)
      else if (name === 'edit_video') out = await runEditVideo(profile, args)
      else if (name === 'motion_control') out = await runMotionControl(profile, args)
      else if (name === 'check_image') out = await runCheckImage(profile, args)
      else if (name === 'check_video') out = await runCheckVideo(profile, args)
      else if (name === 'generate_avatar_video') out = await runGenerateAvatarVideo(profile, args, ctx)
      else if (name === 'check_avatar_video') out = await runCheckAvatarVideo(profile, args)
      else if (name === 'clean_audio') out = await runCleanAudio(profile, args, ctx)
      else if (name === 'lipsync_video') out = await runLipsyncVideo(profile, args, ctx)
      else if (name === 'montage_ia') out = await runMontageIA(profile, args, ctx)
      else if (name === 'check_montage') out = await runCheckMontage(profile, args)
      else if (name === 'get_montage_plan') out = await runGetMontagePlan(profile, args)
      else if (name === 'render_montage_plan') out = await runRenderMontagePlan(profile, args, ctx)
      else if (name === 'list_media') out = await runListMedia(profile)
      else if (name === 'admin_find_user') out = await runAdminFindUser(profile, args)
      else if (name === 'animations_demandees') out = await runAnimationsDemandees(profile, args)
      else return rpcError(id, -32602, `Outil inconnu : ${name}`)
      return rpcResult(id, out)
    }
    console.log('[mcp] méthode non supportée :', method)
    return rpcError(id, -32601, `Méthode non supportée : ${method}`)
  } catch (e) {
    console.error('mcp error:', e)
    return rpcError(id, -32603, 'Erreur serveur — réessaie.')
  }
})
