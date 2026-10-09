// securite.mjs — garde-fous PARTAGÉS du moteur de rendu (audit de sécurité du 02/10).
//
// Le worker tourne avec la clé service (elle ignore la RLS du stockage) et rend dans
// Chromium des pages construites à partir du PLAN — donc de données venues du client
// (app, MCP render_montage_plan, éditeur). Trois familles de garde-fous, réunies ici
// pour que chaque builder utilise LA MÊME version au lieu d'en recopier une variante
// (gen-subs-composition avait son correctif M6 du 14/09, les autres builders aucun) :
//
//   1. cheminSur             — un chemin de stockage venu de la base n'est téléchargé
//                              que s'il vit DANS le dossier du propriétaire du job ;
//   2. jsonPourScript, escAttr, urlCss, NOM_CATALOGUE, remonteHorsProjet, assainirPlan
//                            — une valeur du plan n'injecte jamais de balise, de
//                              script ni de chemin hors du projet de rendu ;
//   3. cspComposition, GSAP_SCRIPT, installerGsap
//                            — la page rendue ne parle qu'au serveur local de
//                              HyperFrames et n'a plus besoin du CDN pour GSAP.
//
// Module SANS effet de bord (pas d'accès réseau, pas de lecture d'env au chargement) :
// les tests l'importent directement (worker.mjs, lui, démarre sa boucle à l'import).

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// ── 1. CHEMINS DE STOCKAGE ──────────────────────────────────────────────────────
// Recensement des producteurs légitimes (02/10) — TOUS tiennent dans ce motif :
//   app      <uid>/in-<ts>.mp4 · <uid>/av<ts>-<i>.mp4 · <uid>/as-<id>.<ext> (id : ast…, lib…,
//            rev…, uadd…, usplit…) · <uid>/bgaud-<ts>.<ext> · <uid>/gen-<ts>.mp4 ·
//            <uid>/mc-<ts>-<rnd>[-matted.webm|-refmask.webm|-bgclean.jpg|-motion].mp4 ·
//            <uid>/retouche-<ts>-<rnd>.mp4|.png|.jpg
//   MCP      <uid>/mcp-montage-<ts>.<ext> · <uid>/mcp-avatar[-<n>]-<ts>.<ext> ·
//            <uid>/mcp-as-<slug>-<ts>.<ext> · <uid>/mcp-retouche/<job>-brut.mp4 ·
//            <uid>/mcp-veo/<job>.<ext> · <uid>/mcp-src/<job>-src.<ext> (mc-ref)
// Un chemin qui COMMENCE par l'uid mais contient un segment parent (« .. », y compris
// encodé « %2e%2e ») est normalisé par l'URL de l'API de stockage et peut viser le
// fichier d'un autre compte : on refuse donc %, \, ?, #, les caractères de contrôle,
// les segments vides et les segments faits uniquement de points.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEGMENT_STOCKAGE = /^[A-Za-z0-9._-]+$/
const INTERDITS_CHEMIN = /[%\\?#\u0000-\u001f\u007f]/

export function cheminSur(uid, p) {
  if (typeof uid !== 'string' || !UUID.test(uid)) return false
  if (typeof p !== 'string' || !p || p.length > 512) return false
  let dec
  try { dec = decodeURIComponent(p) } catch (_) { return false }   // décodé UNE fois : un %2e%2e devient « .. » et tombe ci-dessous
  for (const s of [p, dec]) {
    if (INTERDITS_CHEMIN.test(s)) return false
    if (!s.startsWith(uid + '/')) return false
    const segs = s.slice(uid.length + 1).split('/')
    if (!segs.every((g) => SEGMENT_STOCKAGE.test(g) && !/^\.+$/.test(g))) return false
  }
  return true
}

// « Cloner l'audio de la vidéo » (09/10) : un job 'motion-voix' lit la vidéo (<…>-src.mp4) et la voix convertie (<…>.mp3)
// sous voix-prep/<uid>/ — préfixe qu'aucun compte ne peut lire ni écrire (policies storage : <uid>/… seulement), rempli par
// l'edge voice-change en clé service (copie de la vidéo + voix ElevenLabs). SEULE exception à cheminSur, pour ce seul job.
export function cheminVoixPrep(uid, p) {
  if (typeof uid !== 'string' || !UUID.test(uid) || typeof p !== 'string') return false
  return new RegExp('^voix-prep/' + uid + '/[A-Za-z0-9._-]{4,80}\\.(mp3|mp4)$').test(p) && !/\.\./.test(p)
}
const estVoixJob = (job) => !!(job && job.plan && job.plan.__compose === 'motion-voix')
export function entreeVoixJob(job, a) {
  return estVoixJob(job) && !!a && a.id === 'voix' && /\.mp3$/.test(String(a.path)) && cheminVoixPrep(String(job.user_id || ''), a.path)
}
// fichiers privés d'un job 'motion-voix' (vidéo copiée + voix) : à supprimer une fois le job terminé, quelle qu'en soit l'issue
export function fichiersVoixJob(job) {
  if (!estVoixJob(job)) return []
  const uid = String(job.user_id || '')
  return [job.input_video, ...(Array.isArray(job.assets) ? job.assets : []).map((a) => a && a.path)].filter((p) => cheminVoixPrep(uid, p))
}

// Toutes les entrées d'un job (vidéo de base, assets[].path, avatar_clips) vérifiées
// AVANT le premier téléchargement. Absent = vide ; toute autre forme = refusée.
export function entreesJobSures(job) {
  if (!job || typeof job !== 'object') return false
  const uid = String(job.user_id || '')
  const liste = (x) => (Array.isArray(x) ? x : x == null ? [] : [null])
  const videoSure = cheminSur(uid, job.input_video) || (estVoixJob(job) && /-src\.mp4$/.test(String(job.input_video)) && cheminVoixPrep(uid, job.input_video))
  if (!videoSure || !liste(job.avatar_clips).every((p) => cheminSur(uid, p))) return false
  return liste(job.assets).every((a) => cheminSur(uid, a && a.path) || entreeVoixJob(job, a))
}

// Clé de la vidéo produite. Contrat avec le MCP (02/10) : la vidéo PRÉPARÉE d'un job
// mc-ref (mesurée puis envoyée au fournisseur) vit sous mcp-prep/<uid>/<job>.mp4 —
// préfixe qu'aucun utilisateur ne peut écrire (les policies storage n'ouvrent que
// render-media/<son uid>/). Tous les autres jobs gardent <uid>/<job>.mp4.
export function cleSortieJob(job) {
  return job && job.plan && job.plan.__compose === 'mc-ref'
    ? `mcp-prep/${job.user_id}/${job.id}.mp4`
    : `${job.user_id}/${job.id}.mp4`
}

// ── 2. VALEURS DU PLAN DANS LA PAGE ─────────────────────────────────────────────
// JSON inséré dans un <script> inline : JSON.stringify n'échappe pas « < » — un texte
// contenant « </script> » fermait la balise (le parseur HTML ne connaît pas le contexte
// JS). On neutralise <, >, & et les séparateurs de ligne U+2028/U+2029 : l'expression
// JS garde EXACTEMENT la même valeur (\u003c vaut « < » dans une chaîne JS).
export function jsonPourScript(v) {
  const s = JSON.stringify(v)
  if (s === undefined) return 'null'
  return s.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

// Valeur dans un attribut HTML (src, data-*…) : les cinq caractères qui ferment ou
// ouvrent quelque chose. Le navigateur décode les entités : la valeur lue est intacte.
export const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Adresse dans url('…') À L'INTÉRIEUR d'un attribut style="…". Les entités y sont
// décodées AVANT le CSS : &#39; redevient « ' » et refermerait la chaîne CSS. Les
// caractères qui sortent d'une url('…') (quotes, parenthèses, antislash, blancs) sont
// donc encodés en %XX — une adresse légitime (tuto/x.png, media/avatar.png, lien signé
// Supabase) n'en contient aucun et ressort identique — puis l'attribut est échappé.
// (Pas pour un bloc <style> : les entités n'y sont pas décodées.)
export function urlCss(v) {
  const s = String(v ?? '').replace(/['"()\\<>\s\u0000-\u001f\u007f]/g, (c) => {
    const n = c.charCodeAt(0)
    return n < 0x80 ? '%' + n.toString(16).toUpperCase().padStart(2, '0') : encodeURIComponent(c)
  })
  return escAttr(s)
}

// Noms de fichiers du CATALOGUE embarqué, déduits des vrais fichiers (02/10) :
//   assets/tuto/*.png  : 01-imagesia, 22-claude-connecteurs, hook-qualite, logo-claude, site-home…
//   assets/emoji/*.png : money_bag, check_mark_button, magnifying_glass_tilted_left…
//   assets/sfx/*.mp3   : mo-impact-1, cinematic-impact, mac-typing…
// Un nom hors motif n'a de toute façon aucun fichier : il est ignoré en silence.
export const NOM_CATALOGUE = /^[a-z0-9-]{1,60}$/
export const NOM_EMOJI = /^[a-z0-9_]{1,60}$/
export const NOM_SFX = /^[a-z0-9-]{1,60}$/

// Chemin RELATIF au projet de rendu (photo d'une fenêtre avatar : media/avatar.png,
// media/avatar-2.png). Jamais absolu, jamais de segment « . » / « .. ».
export function cheminProjetSur(p) {
  if (typeof p !== 'string' || !p || p.length > 200) return false
  const segs = p.split('/')
  return segs.length <= 3 && segs.every((g) => SEGMENT_STOCKAGE.test(g) && !/^\.+$/.test(g))
}

// Référence de média du plan qui REMONTE hors du projet de rendu (« ../../x.png », y
// compris encodé). La compilation HyperFrames copie dans le rendu TOUT fichier existant
// visé par un src/href/url() relatif qui sort du projet (collectExternalAssets), pour que
// Chromium puisse l'afficher : un tel chemin dans le plan lisait donc un fichier du
// serveur. Recensement 02/10 des producteurs légitimes — aucun ne remonte : médias du job
// (media/<id>.<ext>, assets/<id>.<ext>), captures (tuto/<nom>.png), logo (brand/logo.<ext>),
// liens signés https du stockage (images perso des animations, menu image du Montage IA).
// file: est toujours refusé.
// Audit 02/10 (relecture) : AUCUNE exception de schéma. HyperFrames (isNonRelativeUrl) ne
// saute que « http:// », « https:// », « // », « data: » en minuscules, « # » et « / » :
// « https:../../x.png », « HTTP:../x », « blob:../x » ou « DATA:../x » étaient donc résolus
// comme des chemins relatifs et copiés. Une URL légitime (lien signé, data: base64) n'a
// jamais de segment « .. » : le contrôle des segments vaut pour TOUTES les chaînes. Et une
// valeur NON-chaîne (src: ['../x.png']) est rendue par String() dans les builders : refusée
// (aucun producteur ne met de tableau, d'objet, de nombre ni de booléen sous ces clés).
const CLES_MEDIA = new Set(['src', 'image', 'url', 'userFile', 'screenFile', 'logoFile', 'file', 'photo', 'poster', 'href'])
export function remonteHorsProjet(v) {
  if (v == null || v === '') return false
  if (typeof v !== 'string') return true
  const s = v.trim()
  if (/^file:/i.test(s)) return true
  // Formes contrôlées : brute (ce que résout la compilation, sans décodage), décodée une fois
  // (decodeURIComponent) et décodée séquence par séquence comme le fait Chromium (%2e, %2f, %5c),
  // qui ne lève jamais d'exception.
  const formes = [s, s.replace(/%2e/gi, '.').replace(/%2f/gi, '/').replace(/%5c/gi, '\\')]
  try { formes.push(decodeURIComponent(s)) } catch (_) {
    // encodage cassé dans un chemin relatif : jamais légitime (inchangé). Dans une adresse à
    // schéma (https://…/promo-50%), les deux autres formes suffisent : on ne la retire pas pour ça.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return true
  }
  return formes.some((x) => x.split(/[\\/]/).some((g) => g.trim() === '..'))
}

// Audit 04/10 (MONT-2) : ADRESSE ABSOLUE dans une référence de média. La compilation HyperFrames
// télécharge côté Node (avant Chromium, donc hors CSP) toute URL https d'un src d'<img>/<video>
// ou d'un url() de fond — vers n'importe quel hôte, redirections suivies, sans plafond de taille.
// Recensement des producteurs légitimes : les seules adresses absolues d'un plan sont les liens du
// stockage Supabase du projet (image perso d'une animation : lien signé mcp-media, _mdUploadAnimImage ;
// anciens liens publics) et des data: (aucun téléchargement). Tout le reste (http(s)://, //, blob:…)
// est retiré : la scène retombe sur son image de repli. `env` : SUPABASE_URL du moteur (tests : injecté).
const STOCKAGE_CHEMIN = /^\/storage\/v1\/object\/(sign|public)\//
export function origineStockage(env = process.env) {
  try { const u = new URL(String((env && env.SUPABASE_URL) || '')); return u.protocol === 'https:' ? u.origin : '' } catch (_) { return '' }
}
export function adresseExterne(v, env = process.env) {
  if (typeof v !== 'string') return false   // non-chaîne : déjà retirée par remonteHorsProjet
  const s = v.trim()
  if (!s) return false
  const absolue = /^[a-z][a-z0-9+.-]*:/i.test(s) || /^[\\/]{2}/.test(s)
  if (!absolue) return false                // chemin du projet (media/x.jpg, tuto/x.png, assets/…)
  if (/^data:/i.test(s)) return false       // contenu embarqué : jamais téléchargé
  const sto = origineStockage(env)
  try {
    const u = new URL(s)
    if (sto && u.origin === sto && STOCKAGE_CHEMIN.test(u.pathname) && !u.username && !u.password) return false
  } catch (_) { /* adresse illisible : retirée */ }
  return true
}

// Assainit le plan À LA SOURCE, avant toute dérivation : les champs qui désignent un
// fichier du catalogue ou du projet sont vérifiés une fois, et TOUS les builders en
// profitent (src="tuto/<screen>.png", copie de assets/tuto/<nom>.png, lecture de la
// photo d'une fenêtre). Rend le nombre de valeurs écartées (journal).
export function assainirPlan(plan, env = process.env) {
  if (!plan || typeof plan !== 'object') return 0
  let n = 0
  // Références de média qui remontent hors du projet, à n'importe quelle profondeur du plan
  // (scènes, items, splits, incrustations…) : retirées — la scène retombe sur son repli.
  // Audit 04/10 (MONT-2) : idem pour une adresse absolue hors du stockage du projet. Exception : la
  // clé « url » d'une SCÈNE est le texte de la barre d'adresse (ui-scenes : « avatarads.fr », le site
  // du client) — jamais téléchargée ; seule celle d'un ITEM (items[].url, image perso de imgSlot) l'est.
  const pile = [[plan, 0, '']]
  let vus = 0
  while (pile.length && vus < 200000) {
    const [o, prof, parent] = pile.pop()
    vus++
    if (!o || typeof o !== 'object' || prof > 24) continue
    if (Array.isArray(o)) { for (const x of o) if (x && typeof x === 'object') pile.push([x, prof + 1, parent]); continue }
    for (const k of Object.keys(o)) {
      const v = o[k]
      const media = CLES_MEDIA.has(k) && (k !== 'url' || parent === 'items')
      if (CLES_MEDIA.has(k) && remonteHorsProjet(v)) { delete o[k]; n++ }
      else if (media && adresseExterne(v, env)) { delete o[k]; n++ }
      else if (v && typeof v === 'object') pile.push([v, prof + 1, k])
    }
  }
  const nom = (o, k, re) => {
    if (!o || typeof o !== 'object' || o[k] == null || o[k] === '') return
    if (typeof o[k] !== 'string' || !re.test(o[k])) { delete o[k]; n++ }
  }
  const slide = (sl) => {
    if (!sl || typeof sl !== 'object') return
    nom(sl, 'screen', NOM_CATALOGUE)
    nom(sl, 'photo', NOM_CATALOGUE)
    nom(sl, 'emoji', NOM_EMOJI)
    if (Array.isArray(sl.assets)) {
      const ok = sl.assets.filter((a) => typeof a === 'string' && NOM_CATALOGUE.test(a))
      n += sl.assets.length - ok.length
      sl.assets = ok
    } else if (sl.assets != null) { delete sl.assets; n++ }
  }
  const liste = (x) => (Array.isArray(x) ? x : [])
  for (const sl of liste(plan.slides)) slide(sl)
  for (const sl of liste(plan.userSlides)) slide(sl)
  for (const w of liste(plan.avatarSegments)) {
    if (!w || typeof w !== 'object') continue
    if (w.photo != null && w.photo !== '' && !cheminProjetSur(w.photo)) { delete w.photo; n++ }
    if (w.split && typeof w.split === 'object') slide(w.split.slide)
  }
  for (const w of liste(plan.wordScript)) nom(w, 'screen', NOM_CATALOGUE)
  const bruitage = (s) => {   // un bruitage sans nom (« ») n'est pas une valeur écartée : rien à compter
    if (s && typeof s === 'object' && s.kind != null && s.kind !== '' && !NOM_SFX.test(String(s.kind))) { s.kind = ''; n++ }
  }
  for (const s of liste(plan.sfx)) bruitage(s)
  for (const s of liste(plan.userSfx)) bruitage(s)
  return n
}

// ── 3. LA PAGE NE PARLE QU'AU SERVEUR LOCAL ─────────────────────────────────────
// HyperFrames sert le projet sur http://localhost:<port> ; la compilation (côté Node)
// rapatrie déjà les médias https en local. La CSP interdit donc toute requête sortante
// du navigateur : fetch/XHR seulement vers le serveur local ('self' : le runtime y lit
// ses sous-compositions), images/médias locaux + data:/blob: (frames injectées par la
// capture) + le stockage Supabase du projet (images personnalisées des animations, lien
// signé, au cas où la compilation n'a pas pu les rapatrier), polices locales/data:.
// script-src et style-src restent ouverts : HyperFrames injecte ses scripts inline.
export function cspComposition(env = process.env) {
  let supa = ''
  try {
    const u = new URL(String((env && env.SUPABASE_URL) || ''))
    if (u.protocol === 'https:') supa = ' ' + u.origin
  } catch (_) { /* pas de stockage distant connu (rendu local) */ }
  const pol = [
    "connect-src 'self'",
    `img-src 'self' data: blob:${supa}`,
    `media-src 'self' data: blob:${supa}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
  return `<meta http-equiv="Content-Security-Policy" content="${pol}" />`
}

// GSAP EMBARQUÉ (vendor/gsap/gsap.min.js, 3.15.0 — la version que HyperFrames 0.7.60
// prend lui-même pour repli CDN). Avant : cdn.jsdelivr.net à chaque rendu, sans
// contrôle d'intégrité. Chaque builder pose GSAP_SCRIPT, le worker copie le fichier
// dans le projet avec installerGsap(proj). Fichier absent = erreur franche, jamais un
// rendu muet sans animations.
// Provenance : copie octet pour octet de package/dist/gsap.min.js du paquet npm
// gsap@3.15.0 (registry.npmjs.org, intégrité sha512-dMW4CWBT…jZB+A==), sha256 du
// fichier 92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb.
// Licence « Standard no charge » de GreenSock (gratuite, redistribution permise).
export const GSAP_SCRIPT = '<script src="vendor/gsap.min.js"></script>'
export const GSAP_SOURCE = join(HERE, 'vendor', 'gsap', 'gsap.min.js')

export function installerGsap(proj) {
  if (!existsSync(GSAP_SOURCE)) throw new Error('GSAP embarqué introuvable (render-worker/vendor/gsap/gsap.min.js)')
  mkdirSync(join(proj, 'vendor'), { recursive: true })
  copyFileSync(GSAP_SOURCE, join(proj, 'vendor', 'gsap.min.js'))
}

// ── 4. CE QUE LE MOTEUR ACCEPTE DE TRAITER (Audit 04/10) ────────────────────────
// GEN-5 : musique de fond du Générateur (plan.music.url). Seule source légitime : la banque du
// site, résolue par l'app (_genServerCompose : new URL('../assets/music/<nom>.mp3', location)) →
// https://avatarads.fr/assets/music/<nom>.mp3. Une musique perso reste un blob: du navigateur,
// jamais envoyée. Le contrôle DNS anti-SSRF puis le fetch faisaient deux résolutions séparées
// (rebinding) : avec un hôte FIXE qui nous appartient, il n'y a plus rien à résoudre côté client.
const MUSIQUE_BANQUE = /^https:\/\/(www\.)?avatarads\.fr\/assets\/music\/[a-z0-9][a-z0-9-]{0,60}\.mp3$/
export function musiqueBanqueSure(u) { return typeof u === 'string' && MUSIQUE_BANQUE.test(u) }

// GEN-4 / EXP-1 : bornes du travail par composition, sur la vidéo RÉELLEMENT reçue (ffprobe) — le
// hint client (plan.duration) n'en est pas une. Marges au-dessus de l'usage légitime :
//   gen-subs : vidéo existante ≤ 5 min (render-job), 4K accepté (gros fichiers, 07/09) ;
//   retouche : Omni Flash / Veo d'Express = 4 à 10 s, 1080p ;
//   motion   : référence Kling ≤ 30 s, rendus ≤ 1080p (on borne large : 5 min, 4K).
// Mesure illisible (durée ou côtés à 0 / NaN) : pas de refus ici — le traitement d'origine garde
// son repli (durée déclarée ≤ 300 s, contrôlée par render-job). Rend un message français ou null.
export const BORNES_MEDIA = {
  'gen-subs': { dureeMax: 305, coteMax: 4096 },
  retouche: { dureeMax: 15, coteMax: 2160 },
  motion: { dureeMax: 305, coteMax: 4096 },
}
export function horsBornes(mesure, bornes) {
  if (!mesure || !bornes) return null
  const d = Number(mesure.duree), w = Number(mesure.largeur), h = Number(mesure.hauteur)
  if (Number.isFinite(d) && d > bornes.dureeMax) return `Vidéo trop longue pour ce rendu (${Math.round(d)} s, ${Math.floor(bornes.dureeMax / 60) ? Math.floor(bornes.dureeMax / 60) + ' min' : bornes.dureeMax + ' s'} maximum).`
  if ((Number.isFinite(w) && w > bornes.coteMax) || (Number.isFinite(h) && h > bornes.coteMax)) return `Résolution trop grande pour ce rendu (${bornes.coteMax} px maximum par côté).`
  return null
}

// MCP-3 : prochain job de la file, ÉQUITABLE entre comptes (pollLoop). Classe prioritaire (`prioritaires` : compositions courtes)
// d'abord, puis le reste. Dans une classe : le plus ancien job ; s'il appartient au compte servi juste avant, le plus ancien
// d'un AUTRE compte passe devant (requête dédiée : aucune fenêtre, un compte qui empile 50 jobs n'en masque aucun autre). Un
// seul compte en file : ordre chronologique inchangé. File vide : deux lectures, comme avant. `sb` = client Supabase (injecté :
// le module reste sans accès réseau à l'import). Rend { id, user_id } ou null (erreur de lecture = null, comme avant).
export async function prochainJob(sb, dernierCompte, prioritaires) {
  const plusAncien = async (prio, autreQue) => {
    let q = sb.from('render_jobs').select('id, user_id').eq('status', 'queued')
    if (prio) q = q.in('plan->>__compose', prioritaires)
    if (autreQue) q = q.neq('user_id', autreQue)
    const { data } = await q.order('created_at').limit(1)
    return (Array.isArray(data) && data[0]) || null
  }
  for (const prio of [true, false]) {
    const premier = await plusAncien(prio, null)
    if (!premier) continue
    if (!dernierCompte || premier.user_id !== dernierCompte) return premier
    return (await plusAncien(prio, dernierCompte)) || premier
  }
  return null
}
