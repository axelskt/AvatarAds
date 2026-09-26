// OmniHuman 1.5 du MCP (lipsync_video engine 'omnihuman') chez kie (Axel 25/09/2026) — mêmes briques que kie-proxy
// (../_shared/kie.ts : suivi normalisé, rapatriement anti-SSRF, format par signature) ; le MCP appelle kie DIRECTEMENT avec
// sa clé (KIEAI_API_KEY) parce qu'il facture lui-même (mcp_spend_credits / mcp_refund_credits, débit avant, rendu sur échec).
//   • soumission : 1080p, jamais le mode rapide, prompt partagé ≤ 300 (shared/omnihuman-prompts.json) ;
//   • kie refuse SANS créer de tâche (code d'erreur dans la réponse) → `sansTache` : l'appelant peut replier sur fal ;
//     kie ne répond pas (délai, réseau) → issue inconnue : ni repli (double coût), ni suivi possible → remboursement ;
//   • suivi : op_name « oh1:<taskId> » (+ « #cut=… » du correctif « dernier mot ») ; le résultat est rapatrié dans NOTRE
//     storage par deliverVideo (l'URL kie expire en ~24 h) ; échec terminal → failAndRefund ;
//   • kie est lent : un job kie n'est déclaré perdu (remboursé) qu'après KIE_OMNI_STALE_MIN, pas 20 min.
// Aucun message renvoyé au client ne nomme le fournisseur.
import { KIE, kieKey, kieHeaders, kieRecord, kieDownload, kieKindOf, kieClientsOn } from '../_shared/kie.ts'
import { omnihumanPrompt, clampOmnihumanPrompt } from '../_shared/omnihuman-prompts.ts'
import { jobSansCoupe } from '../_shared/lipsync-audio.ts'

// Préfixe NEUTRE (fusion 26/09, même règle que « v1: » de Veo) : le client lit ses lignes mcp_jobs (SELECT RLS) → jamais le
// nom du sous-traitant dans op_name. Distinct de « v1: » / « v1r: » (Veo kie), « v3: » (Hedra), « fal: » (OmniHuman fal).
export const OP_KIE_OMNI = 'oh1:'
export const KIE_OMNI_STALE_MIN = 60
// MCP_OMNI_KIE=0 : retour à fal sans redéployer. Fusion 26/09 : l'interrupteur GLOBAL KIE_CLIENTS=0 (kie.ts, « tout refermer
// aux clients ») le coupe aussi, comme Veo du MCP (kieVeoOn) et kie-proxy — sinon ce seul usage client resterait ouvert.
export const omniKieOn = (): boolean => !!kieKey() && kieClientsOn() && (Deno.env.get('MCP_OMNI_KIE') ?? '1').trim() !== '0'
export const estOmniKie = (op: unknown): boolean => String(op || '').startsWith(OP_KIE_OMNI)
export const taskDeOp = (op: unknown): string => jobSansCoupe(String(op || '')).slice(OP_KIE_OMNI.length)
const propre = (m: unknown) => String(m || '').replace(/kie(\.ai)?/gi, 'fournisseur').slice(0, 160)

// Prompt OmniHuman du MCP : pas de détection des mains ici → variante « sans mains » (on ne les invente pas).
// Surcharge du compte propriétaire (tests A/B) : acceptée, coupée à 300 caractères.
export function promptOmniMcp(isOwner: boolean, argPrompt: unknown): string {
  const own = isOwner && typeof argPrompt === 'string' ? clampOmnihumanPrompt(argPrompt) : ''
  return own || omnihumanPrompt({ hands: false })
}

export type SoumissionOmni = { ok: true; taskId: string } | { ok: false; sansTache: boolean; error: string }
export async function soumettreOmniKie(o: { imageUrl: string; audioUrl: string; prompt: string; seed?: number }): Promise<SoumissionOmni> {
  const seed = Number.isInteger(o.seed) && (o.seed as number) >= 0 ? o.seed as number : -1
  const input = { image_url: o.imageUrl, audio_url: o.audioUrl, output_resolution: '1080', pe_fast_mode: false, seed, prompt: clampOmnihumanPrompt(o.prompt) }
  let r: Response, j: any
  try {
    r = await fetch(`${KIE}/api/v1/jobs/createTask`, { method: 'POST', headers: kieHeaders(), body: JSON.stringify({ model: 'omnihuman-1-5', input }), signal: AbortSignal.timeout(30000) })
    j = await r.json().catch(() => ({}))
  } catch (e) {
    console.warn('[mcp] omnihuman kie : soumission sans réponse', (e as Error)?.message)
    return { ok: false, sansTache: false, error: 'le service de génération n’a pas répondu' }
  }
  const taskId = String(j?.data?.taskId || '')
  if (j?.code === 200 && /^[A-Za-z0-9_-]{6,120}$/.test(taskId)) return { ok: true, taskId }
  console.warn('[mcp] omnihuman kie : soumission refusée', j?.code ?? r.status, String(j?.msg || '').slice(0, 200))
  return { ok: false, sansTache: true, error: `refusé par le service de génération (${j?.code ?? r.status})` }
}

// Un cran de suivi : 'attente' (en cours, panne passagère, compte fournisseur à régler), 'pret' (octets MP4 rapatriés),
// 'echec' (échec définitif chez le fournisseur, ou résultat vide / pas une vidéo). Jamais d'exception.
export type AvanceOmni = { etat: 'attente' } | { etat: 'pret'; bytes: Uint8Array } | { etat: 'echec'; raison: string }
export async function avancerOmniKie(taskId: string): Promise<AvanceOmni> {
  try {
    const rec = await kieRecord('mk', taskId)
    if (rec.transient || rec.account || !rec.found) return { etat: 'attente' }   // introuvable juste après la création : on patiente (le filet tranche à 60 min)
    if (rec.state === 'fail' || (rec.state === 'ok' && !rec.urls.length)) return { etat: 'echec', raison: propre(rec.err || 'génération échouée') }
    if (rec.state !== 'ok') return { etat: 'attente' }
    const dl = await kieDownload(rec.urls[0])
    if (!dl) return { etat: 'attente' }                                          // téléchargement raté : on réessaie au prochain passage
    const k = kieKindOf(dl.ct, dl.buf)
    if (!k || k.kind !== 'video') return { etat: 'echec', raison: 'résultat inattendu (pas une vidéo)' }
    return { etat: 'pret', bytes: new Uint8Array(dl.buf) }
  } catch { return { etat: 'attente' } }
}
