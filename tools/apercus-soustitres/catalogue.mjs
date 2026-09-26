// catalogue.mjs — les styles de sous-titres de la Creative Factory (briques factory_bricks kind « sous-titre »)
// et la phrase témoin commune à tous les aperçus.
//
// Chaque style dit QUEL moteur le rend vraiment (pas une imitation) :
//   generateur  → render-worker/gen-subs-composition.mjs (compose serveur du Générateur, via worker.mjs --local)
//   classique   → render-worker/build-composition.mjs (Montage IA, sous-titres .cap : plan.capStyle / plan.slideStyle)
//   dynamique   → render-worker/dynamic-engine.mjs (Montage IA dynamic / apple / slam, bande .dyncap, hook hk1..hk15)
//   usine       → usine/captions.mjs (brûleur de la Creative Factory, le seul que build.mjs applique aujourd'hui)
//   proposition → tools/apercus-soustitres/propositions.mjs (nouveaux styles, dans aucun moteur pour l'instant)
//
// `value` = la valeur EXACTE que le code lit ; `param` = où elle se branche.

export const D = 4.5 // durée des aperçus (s)
export const PHRASE = 'Cette IA crée tes pubs en 30 secondes.'
// cadence parlée d'un hook (~3 mots/s), le dernier mot tient jusqu'à la fin
export const WORDS = [
  { text: 'Cette', start: 0.20, end: 0.46 },
  { text: 'IA', start: 0.46, end: 0.92 },
  { text: 'crée', start: 0.92, end: 1.30 },
  { text: 'tes', start: 1.30, end: 1.50 },
  { text: 'pubs', start: 1.50, end: 1.98 },
  { text: 'en', start: 1.98, end: 2.16 },
  { text: '30', start: 2.16, end: 2.62 },
  { text: 'secondes.', start: 2.62, end: 4.20 },
]
export const ACCENTS = ['IA', '30', 'secondes'] // mots forts (plan.accents / caption.accent du Montage IA)
export const bare = (t) => String(t).toLowerCase().replace(/[.,!?;:«»()"']/g, '')
export const isAccent = (t) => ACCENTS.map(bare).includes(bare(t))

// status : 'ready' = utilisable par l'usine ; 'draft' = proposition (jamais tirée, cf. usine/coherence.js ready())
// poster = instant (s) de la vignette dans l'aperçu final
export const STYLES = [
  // ── existants (ids déjà en base) ──
  { id: 'S01', label: 'Mot par mot (page blanche, Anton capitales)', source: 'montage-ia', engine: 'classique', value: 'word', param: 'plan.slideStyle', opts: { slideStyle: 'word', shift: 1.7, render: 10, cut: 1.5 }, poster: 2.45 },
  { id: 'S02', label: 'Caption usine (mot à mot blanc, contour noir)', source: 'usine', engine: 'usine', value: 'caption', param: 'usine/captions.mjs', poster: 3.0 },
  { id: 'S03', label: 'Karaoké (mot actif en pastille bleue)', source: 'generateur', engine: 'generateur', value: 'karaoke', param: 'selSubStyle', poster: 2.4 },
  { id: 'S04', label: 'Néon Générateur (vert et violet lumineux)', source: 'generateur', engine: 'generateur', value: 'neon', param: 'selSubStyle', poster: 2.4 },
  { id: 'S05', label: 'TikTok Pills (pastilles rose et jaune)', source: 'generateur', engine: 'generateur', value: 'tiktok', param: 'selSubStyle', poster: 2.4 },
  { id: 'S06', label: 'Hormozi (Impact, mot actif jaune)', source: 'generateur', engine: 'generateur', value: 'hormozi', param: 'selSubStyle', poster: 2.4 },
  // ── Générateur : les 4 styles de l'app qui n'étaient pas encore des briques ──
  { id: 'S07', label: 'MrBeast (mot actif en boîte rouge)', source: 'generateur', engine: 'generateur', value: 'mrbeast', param: 'selSubStyle', poster: 2.4 },
  { id: 'S08', label: 'Punch Générateur (un mot à la fois, contour noir)', source: 'generateur', engine: 'generateur', value: 'iman', param: 'selSubStyle', poster: 2.4 },
  { id: 'S09', label: 'Podcast (mot actif blanc, autres estompés)', source: 'generateur', engine: 'generateur', value: 'podcast', param: 'selSubStyle', poster: 2.4 },
  { id: 'S10', label: 'White (capitales blanches, ombre douce)', source: 'generateur', engine: 'generateur', value: 'badis', param: 'selSubStyle', poster: 2.4 },
  // ── Montage IA : sous-titres du moteur classique ──
  { id: 'S11', label: 'Punch Montage IA (un mot, contour noir, accent orange)', source: 'montage-ia', engine: 'classique', value: 'punch', param: 'plan.capStyle', opts: { capStyle: 'punch' }, poster: 3.0 },
  { id: 'S12', label: 'Néon Montage IA (blanc, halo rose, accent cyan)', source: 'montage-ia', engine: 'classique', value: 'neon', param: 'plan.capStyle', opts: { capStyle: 'neon' }, poster: 3.0 },
  { id: 'S13', label: 'Minimal (sans contour, ombre douce)', source: 'montage-ia', engine: 'classique', value: 'minimal', param: 'plan.capStyle', opts: { capStyle: 'minimal' }, poster: 1.7 },
  { id: 'S14', label: 'Éditorial (sérif fin, accent italique)', source: 'montage-ia', engine: 'classique', value: 'editorial', param: 'plan.slideStyle', opts: { capStyle: 'auto', slideStyle: 'editorial' }, poster: 3.0 },
  // ── Montage IA : moteur dynamique (mots qui s'accumulent) — apple (« Anim ») a exactement la même bande ──
  { id: 'S15', label: 'Dynamique (mots qui s\'accumulent, mot fort orange)', source: 'montage-ia', engine: 'dynamique', value: 'dynamic', also: ['apple'], param: 'plan.slideStyle', opts: { slideStyle: 'dynamic', hook: false }, poster: 3.3 },
  { id: 'S16', label: 'Slam (mots qui s\'accumulent, mot fort jaune)', source: 'montage-ia', engine: 'dynamique', value: 'slam', param: 'plan.slideStyle', opts: { slideStyle: 'slam', hook: false }, poster: 3.3 },
  // ── Montage IA : sous-titres du HOOK (phrase entière, plan.hookStyle) ──
  { id: 'S17', label: 'Hook néon rouge hk15 (défaut validé)', source: 'montage-ia', engine: 'dynamique', value: 'hk15', param: 'plan.hookStyle', opts: { slideStyle: 'dynamic', hook: true, hookStyle: 15 }, poster: 3.45 },
  { id: 'S18', label: 'Hook or et rouge hk1 (dégradé Anton)', source: 'montage-ia', engine: 'dynamique', value: 'hk1', param: 'plan.hookStyle', opts: { slideStyle: 'dynamic', hook: true, hookStyle: 1 }, poster: 3.45 },
  { id: 'S19', label: 'Hook CapCut hk7 (Montserrat, contour noir, jaune)', source: 'montage-ia', engine: 'dynamique', value: 'hk7', param: 'plan.hookStyle', opts: { slideStyle: 'dynamic', hook: true, hookStyle: 7 }, poster: 3.45 },
  // ── PROPOSITIONS (26/09) : status draft, meta.proposal = true ──
  { id: 'S20', label: 'Surligneur (marqueur jaune qui passe sous le mot)', source: 'proposition', engine: 'proposition', value: 'surligneur', param: 'proposition', proposal: true, poster: 3.3 },
  { id: 'S21', label: 'Boîte blanche (texte natif TikTok)', source: 'proposition', engine: 'proposition', value: 'boite-blanche', param: 'proposition', proposal: true, poster: 3.3 },
  { id: 'S22', label: 'Contour XXL couleur (2 mots géants)', source: 'proposition', engine: 'proposition', value: 'contour-xxl', param: 'proposition', proposal: true, poster: 1.3 },
  { id: 'S23', label: 'Mot-clé sur aplat (le mot fort claque sur un bloc de couleur)', source: 'proposition', engine: 'proposition', value: 'aplat', param: 'proposition', proposal: true, poster: 2.9 },
  { id: 'S24', label: 'Affiche choc (typo empilée, lignes justifiées)', source: 'proposition', engine: 'proposition', value: 'affiche', param: 'proposition', proposal: true, poster: 3.3 },
]

export const PUB = 'https://guvwgiejzkiodghywpwj.supabase.co/storage/v1/object/public/'
export const storagePath = (id, ext) => `factory-media/subtitles/${id}.${ext}`
