// ── DÉCUPLEUR (Axel 24/10) : règles communes à render-job, kie-proxy et mcp ─────────────────────────────────────────
// Une vidéo → N variantes toutes différentes (render-worker/decupleur.mjs), avec en option le changement de personnage
// (Wan 3.0 chez kie, alias wan-3). Réservé Pro / Élite (Axel 24/10 : raison d'upgrader pour un Starter). Pendant les tests :
// owner / developer SEULEMENT — l'ouverture se fait par le secret DECUPLEUR_OUVERT=1 (+ DC_OUVERT dans l'app), en même
// temps que le tirage des crédits côté app (render-job / kie-proxy, voir les commentaires « À L'OUVERTURE »).

export const DC_PLANS = ['starter', 'pro', 'elite']   // 27/10 (Axel) : ouvert à tous les plans payants (avant : Pro / Élite)
export const decupleurOuvert = () => Deno.env.get('DECUPLEUR_OUVERT') === '1'
export const DC_VARIANTES = [5, 10, 20, 50]
export const DC_CR_VARIANTE = 0.5          // = DC_CR_PER_VARIANT de l'app (10 variantes = 5 crédits)
export const DC_PERSO_CR_SEC = 10          // = DC_PERSO_CR_SEC de l'app : par seconde gardée, arrondie au-dessus (comme kie)
export const DC_PASSAGE_MAX = 60           // secondes gardées sans changement de personnage (= render-worker/decupleur.mjs)
export const DC_PERSO_MAX = 15             // avec changement de personnage (référence kie : 15 s au total)
export const DC_BUDGET_S = 900             // N × passage ≤ 15 min produites par lot
// 30/10 (audit Décupleur, failles 3-4, et relecture) : bornes des travaux GRATUITS, appliquées ATOMIQUEMENT par
// render_job_dc_creer (migration 20261030140000) pour render-job (app) ET le MCP. Un seul travail court gratuit (dc-fetch,
// dc-cut, mc-ref) en file ou en cours par compte ; liens récupérés : 6 par 10 min ; découpes : 10 par 10 min.
// 2e relecture 30/10 : « 1 travail court » compté PAR FAMILLE (dc-fetch + dc-cut ; mc-ref) — l'app et les cartes Omni / Motion
// Control ne se bloquent plus — et préparations mc-ref des cartes Claude : 10 par 10 min (DC_PREP_QUOTA, échecs compris), 3
// préparations ÉCHOUÉES par heure au plus (DC_PREP_ECHECS_MAX : un échec n'est jamais débité).
export const DC_FETCH_QUOTA = 6, DC_CUT_QUOTA = 10, DC_FETCH_FENETRE_S = 600, DC_COURT_EN_COURS_MAX = 1, DC_PREP_QUOTA = 10, DC_PREP_ECHECS_MAX = 3
// Liens acceptés (MÊME motif que render-worker/decupleur.mjs, revérifié par le moteur)
export const DC_LIEN = /^https:\/\/(?:(?:www|m|vm|vt)\.)?(?:tiktok\.com|instagram\.com)\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{1,400}$/
// 30/10 (audit Décupleur, faille 2) : un lien de LIVE est refusé dès la vérification (TikTok /@compte/live,
// m.tiktok.com/share/live/…, Instagram /<compte>/live/). Un direct n'a pas de fin : son enregistrement par le moteur
// remplissait /tmp. MÊME règle que lienEstLive de render-worker/decupleur.mjs (revérifié par le moteur).
// Relecture du 30/10 : le chemin est DÉCODÉ (%XX un par un, jusqu'à ce qu'il ne change plus ; plus de 5 couches = refus ;
// un « %zz » ne bloque pas le décodage) AVANT d'être coupé sur ? et # (sinon « /live%3Fx », « /live%23 » passaient),
// « \ » compte comme « / ». Refusé si :
//   · un segment vaut « live » suivi de rien ou d'un séparateur (« /live », « /live/ », « /live; », « /live. », « /live%… ») ;
//     un compte Instagram « /live.musique/reel/… » reste accepté ;
//   · OU, sur TikTok, le segment après « @compte/ » COMMENCE par « live » : l'extracteur live de yt-dlp prend
//     « @compte/live » comme PRÉFIXE (« /@u/lively » y part aussi). « /@livestreamer/video/… » reste accepté.
export function lienEstLive(v: unknown): boolean {
  let chemin = String(v ?? '').trim().replace(/^[a-z]+:\/\/[^/?#]*/i, '')
  for (let i = 0; ; i++) {
    const d = chemin.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    if (d === chemin) break
    if (i === 5) return true   // encodé plus de 5 fois : aucun lien honnête n'est fait comme ça
    chemin = d
  }
  chemin = chemin.split(/[?#]/)[0].replace(/\\/g, '/')
  return /(?:^|\/)live(?![\w-]|\.+[\w-])/i.test(chemin) || /(?:^|\/)@[^/]*\/live/i.test(chemin)
}
export const DC_MSG_LIVE = 'Lien de live : le Décupleur ne prend que des vidéos publiées (3 min maximum)'
export function lienDecupleur(v: unknown): string | null {
  let u = String(v ?? '').trim().slice(0, 450)
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  u = u.replace(/^http:\/\//i, 'https://')
  return DC_LIEN.test(u) && !lienEstLive(u) ? u : null
}

// Prompt du changement de personnage (Wan 3.0, mode référence : Video1 = passage gardé, Image1 = nouveau personnage).
// Mission (Axel 24/10) : remplacer le personnage de la vidéo par l'avatar donné — mêmes mouvements, avatar 1:1 à la
// photo, AUCUN mouvement inventé ; le reste de la vidéo ne bouge pas. Règle des prompts de réalisme (skill images-ia) :
// le détail dit CE QU'ON VEUT VOIR, l'interdit dit COMMENT NE PAS L'OBTENIR. Servi par kie-proxy (l'app n'envoie pas de
// prompt) et par le MCP : une seule version.
export const DC_WAN_PROMPT = [
  'Video editing task: character replacement only. Video1 is the source video. Image1 is the new character.',
  'Replace the person in Video1 with the person in Image1. This is the ONLY change. If several people appear, replace only the main person facing the camera.',
  'The new person must be a 1:1 match of Image1: exactly the same face, facial features, skin tone, hair color, length and style, body shape and proportions, clothing and accessories as in Image1, identical in every frame from the first to the last.',
  'Take NOTHING of the original person’s appearance (face, hair, body, clothes): take only their movement.',
  'Motion comes ONLY from Video1: the new person performs exactly the same movements as the person in Video1, at the same moments and the same speed — same body pose, gestures, hand movements, head movements, gaze direction, facial expressions and mouth movements (the lips follow the original speech of Video1 exactly). Same position, size and framing of the person in the frame.',
  'Do not invent, add, exaggerate, smooth out or skip any movement.',
  'Everything else stays exactly as in Video1: camera framing, camera movement and handheld shake, background and every object, lighting and color grade, timing, duration, speed, aspect ratio, and any on-screen text or overlays. Do not add, remove or move any object, person, text or logo. No cut, no transition, no new camera angle, no zoom.',
  'Photorealistic, natural smartphone footage: real skin texture with pores and small imperfections, natural light on the new person that matches the scene.',
  'Never: beauty filter, skin smoothing, plastic or waxy skin, cartoon, CGI or painted look, blur, flicker, morphing face, identity drift, invented movement, extra or missing fingers, distorted hands.',
].join(' ')

// 27/10 (Axel : « mettre plusieurs personnages, un à droite et un à gauche ») : jusqu'à DC_PERSOS_MAX photos dans UNE génération
// (Wan 3.0 référence : Image1, Image2… dans l'ordre d'envoi), chacune remplace la personne à SA place dans l'image.
// Un seul personnage sans place = DC_WAN_PROMPT tel quel (la personne principale). Même prix (par seconde gardée).
export const DC_PERSOS_MAX = 3
export const DC_PLACES = ['principal', 'gauche', 'centre', 'droite'] as const
const PLACE_EN: Record<string, string> = { gauche: 'on the LEFT side of the frame', centre: 'in the CENTER of the frame', droite: 'on the RIGHT side of the frame' }
// places valides : 1 personnage = une place (principal par défaut) ; plusieurs = gauche / centre / droite, chacune une seule fois
export function placesDecupleur(raw: unknown, n: number): string[] | null {
  if (n < 1 || n > DC_PERSOS_MAX) return null
  const arr = Array.isArray(raw) ? raw.map((x) => String(x ?? '').toLowerCase()) : []
  if (n === 1) { const p = arr[0] || 'principal'; return (DC_PLACES as readonly string[]).includes(p) ? [p] : null }
  if (arr.length !== n || arr.some((p) => !PLACE_EN[p]) || new Set(arr).size !== n) return null
  return arr
}
export function dcWanPrompt(places: string[]): string {
  if (places.length === 1 && places[0] === 'principal') return DC_WAN_PROMPT
  const who = places.map((p, i) => `Image${i + 1} is the new character for the person ${PLACE_EN[p]}.`).join(' ')
  const one = places.length === 1
  return [
    `Video editing task: character replacement only. Video1 is the source video. ${who}`,
    one ? `Replace ONLY the person ${PLACE_EN[places[0]]} in Video1 with the person in Image1. Every other person stays exactly as in Video1.`
        : `Replace each of these people in Video1 with their own image: ${places.map((p, i) => `the person ${PLACE_EN[p]} becomes the person in Image${i + 1}`).join('; ')}. Never swap them, never merge them, never give two people the same face. Any other person stays exactly as in Video1.`,
    `Each new person must be a 1:1 match of their image: exactly the same face, facial features, skin tone, hair color, length and style, body shape and proportions, clothing and accessories, identical in every frame from the first to the last.`,
    `Take NOTHING of the original people’s appearance (face, hair, body, clothes): take only their movement.`,
    `Motion comes ONLY from Video1: each new person performs exactly the same movements as the person they replace, at the same moments and the same speed — same body pose, gestures, hand movements, head movements, gaze direction, facial expressions and mouth movements (the lips follow the original speech of Video1 exactly). Same position, size and framing of each person in the frame.`,
    'Do not invent, add, exaggerate, smooth out or skip any movement.',
    'Everything else stays exactly as in Video1: camera framing, camera movement and handheld shake, background and every object, lighting and color grade, timing, duration, speed, aspect ratio, and any on-screen text or overlays. Do not add, remove or move any object, person, text or logo. No cut, no transition, no new camera angle, no zoom.',
    'Photorealistic, natural smartphone footage: real skin texture with pores and small imperfections, natural light on the new people that matches the scene.',
    'Never: beauty filter, skin smoothing, plastic or waxy skin, cartoon, CGI or painted look, blur, flicker, morphing face, identity drift, invented movement, extra or missing fingers, distorted hands.',
  ].join(' ')
}
