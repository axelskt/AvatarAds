// Entrées CLIENT du moteur de rendu — audit de sécurité du 02/10 : chemins de stockage (WRK-1) et plan de rendu (WRK-4).
// Fonctions pures (aucun accès réseau ni base) : testables seules avec `deno test`.
//
// ── CHEMINS (WRK-1) ──
// Le service (clé service_role) signe, télécharge et confie au moteur de rendu des chemins du bucket render-media SANS
// RLS. Un contrôle « commence par <uid>/ » ne suffit pas : supabase-js colle le chemin tel quel dans l'URL de l'API
// Storage (…/object/sign/render-media/<chemin>), donc un segment parent (« .. », « %2e%2e », « .%2E ») est normalisé
// par l'URL et vise le fichier d'un AUTRE compte, voire un autre bucket. Seul un motif fermé protège : segments de
// lettres, chiffres, « . », « _ », « - », jamais « . » ni « .. » entiers, sous le dossier du compte.
//
// Recensement 02/10 des producteurs légitimes (tous acceptés tels quels) :
//   app/index.html  <uid>/in-<ts>.mp4 · <uid>/av<ts>-<i>.mp4 · <uid>/as-<ast|lib|rev|uadd|usplit…>.<jpg|mp4>
//                   <uid>/bgaud-<ts>.<ext> · <uid>/gen-<ts>.mp4 · <uid>/mc-<ts>-<rnd>(-motion|-matted|-refmask|-bgclean).<ext>
//                   <uid>/retouche-<ts>-<rnd>.<mp4|png|jpg>
//   mcp/index.ts    <uid>/mcp-montage-<ts>.<ext> · <uid>/mcp-avatar(-<n>)-<ts>.<ext> · <uid>/mcp-as-<slug>-<ts>.<ext>
//                   <uid>/mcp-src/<job>-src.<mp4|mov|webm> · <uid>/mcp-veo/<job>.<ext> · <uid>/mcp-retouche/<job>-brut.mp4
// Aucun ne contient d'espace, d'accent ni de caractère encodé.

const SEGMENT = /^[A-Za-z0-9._-]+$/
const UID = /^[A-Za-z0-9-]{1,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const CHEMIN_MAX = 300

// Chemin sûr DANS le dossier <uid>/ (render-media, mcp-media). Renvoie le chemin normalisé (décodé une fois) ou null.
export function cheminSur(uid: string, p: unknown): string | null {
  if (typeof p !== 'string' || !UID.test(String(uid || ''))) return null
  if (!p || p.length > CHEMIN_MAX) return null
  let d: string
  try { d = decodeURIComponent(p) } catch { return null }   // « %E0 » isolé, etc.
  if (!d || d.length > CHEMIN_MAX) return null
  // encore un « % » après décodage = double encodage ; \ ? # et caractères de contrôle n'ont rien à faire dans une clé
  if (/[%\\?#]/.test(d) || /[\u0000-\u001f\u007f]/.test(d)) return null
  if (!d.startsWith(uid + '/')) return null
  const segs = d.slice(uid.length + 1).split('/')
  for (const s of segs) {
    if (!s || s === '.' || s === '..') return null   // segment vide (« a//b », « a/ ») ou parent
    if (!SEGMENT.test(s)) return null
  }
  return d
}

// Sortie de la PRÉPARATION d'une vidéo MCP (job render_jobs __compose 'mc-ref') — CONTRAT avec render-worker (02/10) :
// le worker la dépose dans render-media sous mcp-prep/<user_id>/<job_id>.mp4, hors du dossier <uid>/ (que l'utilisateur
// peut écrire avec sa session) → la vidéo mesurée puis facturée ne peut plus être remplacée avant l'envoi au moteur.
export function clePrepMcp(uid: string, renderJobId: string): string | null {
  if (!UUID.test(String(uid || '')) || !UUID.test(String(renderJobId || ''))) return null
  return `mcp-prep/${uid}/${renderJobId}.mp4`
}

// ── PLAN DE RENDU REÇU DU CLIENT (WRK-4) ──
// render-job insérait le plan tel quel : un client pouvait y poser les drapeaux INTERNES du moteur (__compose 'mc-ref' /
// 'retouche' = passer devant toute la file prioritaire, __batchBlank = régénérer les aperçus publics, __lipsync = faire
// générer des scènes par le fournisseur de lipsync aux frais du service) et un plan de plusieurs Mo.
//
// Recensement 02/10 des clés « __ » de premier niveau RÉELLEMENT envoyées à render-job :
//   app/index.html   __compose 'gen-subs' (Générateur, l.~26863), 'motion-bg' (l.~31839), 'motion-split' (l.~32039).
//                    'retouche' passe par l'action dédiée de render-job, jamais par un plan client.
//   régénération     « Détails du montage » renvoie le plan STOCKÉ recopié tel quel (_mdBuildRegenPlan) : celui d'un
//                    montage lancé depuis Claude porte __lipsync (et __brief sur d'anciens plans). Rien d'autre.
//   mcp/index.ts     __compose 'mc-ref' / 'retouche', __lipsync, __brief : insérés en clé service, jamais via render-job.
//   render-worker    __batchBlank : inséré À LA MAIN (SQL) pour le compte propriétaire, jamais via render-job.
// Tailles mesurées : un plan d'app fait quelques Ko à ~150 Ko (orchestrate : 180 s max, ≤ 900 mots en _words et
// captions, ≤ 40 slides de ≤ 8 items) ; les sous-titres du Générateur ≤ ~1 500 mots sur 300 s.
export const PLAN_MAX_OCTETS = 512 * 1024   // > 3× le plus gros plan réel
export const TABLEAU_MAX = 3000             // n'importe quel tableau, à n'importe quelle profondeur (mots de 300 s parlés vite)
export const PROFONDEUR_MAX = 16
// tableaux « principaux » du montage : orchestrate en produit ≤ 40 (slides) et quelques dizaines pour le reste (beats =
// mots forts, tuto = étapes de visite guidée, beds = nappes) ; la régénération en ajoute au plus une par scène de l'écran.
// Les tableaux mot à mot (_words, captions, subs.whisper : jusqu'à ~1 500 entrées) ne sont bornés que par TABLEAU_MAX.
export const PRINCIPAUX_MAX = 300
const PRINCIPAUX = ['slides', 'userSlides', 'broll', 'sfx', 'userSfx', 'zooms', 'sections', 'avatarSegments', 'userBans', 'splits', 'accents', 'beats', 'tuto', 'beds']
const COMPOSE_CLIENT = ['gen-subs', 'motion-bg', 'motion-split']
const HERITEES = ['__lipsync', '__brief']   // acceptées seulement si elles REPRENNENT la valeur d'un job précédent du compte
const REFUSEES = ['__batchBlank']           // drapeaux propriétaire : jamais d'un client

export type Refus = { status: number; error: string }

// Taille, profondeur et longueur des tableaux d'un plan déjà décodé. null = conforme.
export function controlerTaillePlan(plan: unknown): Refus | null {
  let json = ''
  try { json = JSON.stringify(plan) ?? '' } catch { return { status: 400, error: 'plan invalide' } }
  if (new TextEncoder().encode(json).length > PLAN_MAX_OCTETS) return { status: 413, error: 'plan trop volumineux' }
  const p = plan as Record<string, unknown>
  for (const k of PRINCIPAUX) if (Array.isArray(p?.[k]) && (p[k] as unknown[]).length > PRINCIPAUX_MAX) return { status: 413, error: 'plan trop volumineux' }
  const pile: [unknown, number][] = [[plan, 0]]
  while (pile.length) {
    const [v, prof] = pile.pop()!
    if (v === null || typeof v !== 'object') continue
    if (prof > PROFONDEUR_MAX) return { status: 400, error: 'plan invalide' }
    if (Array.isArray(v)) {
      if (v.length > TABLEAU_MAX) return { status: 413, error: 'plan trop volumineux' }
      for (const x of v) pile.push([x, prof + 1])
    } else for (const x of Object.values(v as Record<string, unknown>)) pile.push([x, prof + 1])
  }
  return null
}

// Son de l'utilisateur dans un plan : userAudioPath doit rester dans SON dossier (sinon retiré, comme avant) ; userAudio
// (nom de fichier LOCAL posé par le worker au téléchargement, joint à son dossier de travail) ne vient jamais d'un client ;
// userAudioVol est interpolé dans un filtre ffmpeg → nombre borné ou retiré. Aucun producteur légitime ne pose les deux derniers.
export function nettoyerSonUtilisateur(uid: string, plan: Record<string, unknown>): void {
  if (plan.userAudioPath !== undefined) {
    const c = cheminSur(uid, plan.userAudioPath)
    if (c) plan.userAudioPath = c
    else delete plan.userAudioPath
  }
  delete plan.userAudio
  if (plan.userAudioVol !== undefined) {
    const v = plan.userAudioVol
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 2) plan.userAudioVol = v
    else delete plan.userAudioVol
  }
}

// Plan d'une action 'create' de render-job. `herite` = plan d'un job précédent du MÊME compte sur la MÊME vidéo source
// (régénération) ou null. Modifie `plan` sur place ; renvoie un refus (message français, sans écho de l'entrée) ou les
// clés internes retirées (pour le journal).
export function planClientRenderJob(uid: string, plan: Record<string, unknown>, herite: Record<string, unknown> | null): Refus | { retirees: string[] } {
  const taille = controlerTaillePlan(plan)
  if (taille) return taille
  const retirees: string[] = []
  for (const k of Object.keys(plan)) {
    if (!k.startsWith('__')) continue
    if (k === '__compose') {
      if (typeof plan[k] === 'string' && COMPOSE_CLIENT.includes(plan[k] as string)) continue
      return { status: 400, error: 'plan invalide' }   // 'mc-ref' / 'retouche' / inconnu : réservé au serveur
    }
    if (REFUSEES.includes(k)) return { status: 400, error: 'plan invalide' }
    if (HERITEES.includes(k)) {
      // l'appelant peut RETIRER ces drapeaux (false / absent), jamais les AJOUTER : seule la valeur du job d'origine passe
      const demande = plan[k] !== undefined && plan[k] !== false && plan[k] !== null
      if (demande && herite && herite[k] !== undefined && herite[k] !== null && herite[k] !== false) { plan[k] = herite[k]; continue }
    }
    delete plan[k]
    retirees.push(k)
  }
  const d = Number(plan.duration)
  if (Number.isFinite(d)) plan.duration = d   // interpolé tel quel dans des filtres ffmpeg du worker : un NOMBRE, jamais une chaîne
  nettoyerSonUtilisateur(uid, plan)
  return { retirees }
}
