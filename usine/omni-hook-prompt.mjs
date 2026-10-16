// Prompt des hooks Omni (A3, A4…) pour l'usine — Axel 12/10 : « l'avatar arrive brut ». Réf. @devinjatho (« You Will Never
// Go Viral If… ») : arrivée pleine d'émotion, élocution fluide, il parle BEAUCOUP avec les mains, l'émotion évolue.
// Réservé à l'usine (MCP generate_video) : le style « UGC réel » de l'app n'est PAS modifié pour les clients.
// Règles déjà en place à garder : français de France sans accent canadien/québécois, débit continu sans blanc,
// jamais de mot inventé, fin propre (voir express-prompts.ts).
export const HOOK_PERFORMANCE = [
  'ENTRANCE (first 0.5 s): the clip opens already in motion, never on a frozen face — the person leans slightly toward the phone with raised eyebrows, wide expressive eyes and an excited half-smile, as if they just discovered something incredible and can not wait to tell it; they start speaking within the first 0.3 s.',
  // Axel 12/10 (3e tour) : réf. « HANDS » et « EMOTION » de @devinjatho — une SUITE de gestes et d'émotions sur la phrase
  'HAND CHOREOGRAPHY across the sentence, one clear gesture per idea: 1) a closed fist punching lightly forward on the first strong word, 2) both hands opening wide, palms out, fingers spread, 3) both hands cupped together as if holding the idea, 4) both hands reaching toward the camera, palms up, offering it to the viewer, 5) a last emphatic two-hand gesture toward the camera ON the very last word. The hands keep talking until the very last word and the final second: they never drop, rest or freeze before the clip ends.',
  'EMOTION ARC across the sentence: laughing squint at the start → warm, open, welcoming expression → big genuine smile → wide grin → star-struck excitement on the punchline.',
  'HANDS: they talk a lot with BOTH hands, visible in frame at chest height — open palms toward the camera, counting on fingers, pointing at the lens, framing an idea with both hands, a quick emphatic gesture on the key words (the emphasis is in the hands and the voice, NEVER in repeating the word); the hands keep moving naturally for the whole clip, never resting out of frame.',
  // Axel 12/10 (2e tour) : plus d'émotion du visage et de la tête
  'EMOTION: VERY expressive face, much more than a neutral talking head — big eyebrow raises, eyes widening on the surprising words, real smiles that reach the eyes, a playful squint or frown of disbelief, lips and cheeks moving with the emotion; the emotion visibly evolves through the sentence (surprise → excitement → conviction → a knowing smile on the punchline).',
  // Axel 12/10 (4e tour) : « plus de mouvement de tête » (réf. @devinjatho : tête qui penche d'un côté à l'autre, yeux fermés sur l'emphase)
  // Axel 16/10 (« il bégaye, il dit plusieurs fois le même mot, et c'est souvent ») : les mouvements de tête et les yeux
  // fermés se font PENDANT que les mots continuent — jamais de reprise de la phrase après un geste (« relève la tête » → il
  // redisait les derniers mots). Consigne « UNE SEULE PRISE » plus bas.
  'HEAD MOVEMENT (a lot, like an animated storyteller): the head is in motion on almost every word — it tilts clearly to one side then to the other, bobs with the rhythm of the words, dips the chin and closes the eyes for a beat on an emphasized word then lifts back up with wide eyes while the sentence keeps going forward, shakes slightly in disbelief, leans in toward the lens on the key part then pulls back; the shoulders and upper body follow the head naturally. Never a static head, never robotic. Every head move happens WHILE the words keep flowing: it never pauses, interrupts or restarts the sentence.',
  // Axel 12/10 (5e tour) : « encore plus d'expression au niveau de la tête » (réf. : yeux fermés en parlant, menton baissé puis relevé, moue « ooh »)
  'HEAD EXPRESSIONS (big, theatrical, like the best storytellers on TikTok): once or twice he keeps his EYES CLOSED while still talking, head tilted down as if savoring what he says, then brings the head back up with wide open eyes and simply CONTINUES with the next words (never re-says what he just said); the chin goes up proudly on a bold claim; a pursed-lips smirk with one eyebrow raised; an open-mouthed "ooh" face with eyebrows high on the surprising part; the head moves a lot between these expressions.',
  // Axel 12/10 : « parler plus rapidement » (H20 en 8 s : fini à 6,3 s puis figé) → débit rapide + durée = cran juste au-dessus de la parole
  'DELIVERY: FAST, brisk pace (about 3.5 words per second), confident, fluid and well articulated like a charismatic content creator, energetic conversational rhythm, every word crisp and clear; never slow, never drawn out.',
  // Axel 16/10 : bégaiement / mots dits deux fois → une seule prise propre, chaque mot UNE fois, et le temps en trop se
  // remplit par des gestes et un sourire, JAMAIS en redisant des mots. Aucun exemple de mot français entre guillemets ici :
  // le moteur pourrait le dire (seule la réplique entre « … » est parlée). Cas réel : A3-2 H81 « un bracelet en bracelet ».
  'ONE CLEAN TAKE (absolute priority over every gesture and expression above): the line is said exactly ONCE, from the first word to the last, each word exactly once and in order — no stutter, no repeated word, no repeated group of words, no repeated syllable, no false start, no restart, no going back to re-say a part of the sentence after a gesture, a head move or closed eyes, no filler sound or filler word, no word added for emphasis. A perfectly fluent native speaker who never trips on a word. If the line is finished before the end of the clip, he stops talking and keeps smiling and gesturing silently — he never repeats words to fill the time.'
].join(' ');

// Axel 12/10 (A4-2 H78 : « IO IA ») : consigne de prononciation ajoutée dès qu'un sigle / une marque est dans la réplique
const PRON = [
  [/\bIA\b/, 'IA is said ONCE as the two French letters i-a, never IO, never IO IA, nothing added before it'],
  [/AvatarAds/i, 'AvatarAds is pronounced avatar-ads, one word'],
  [/Higgsfield/i, 'Higgsfield is pronounced higs-field'],
  [/CapCut/i, 'CapCut is pronounced cap-cut'],
  [/\bUGC\b/, 'UGC is said as the French letters u-gé-cé'],
  [/10 000€|10 000 €/, '10 000€ is said dix mille euros'],
];
function pronunciation(line) {
  const r = PRON.filter(([re]) => re.test(line)).map(([, t]) => t);
  return r.length ? ' PRONUNCIATION: ' + r.join('; ') + '.' : '';
}
// Réplique + performance, dans l'ordre attendu par le MCP (la réplique entre « … » est dite mot pour mot).
export function hookPrompt(line) {
  return `The person in the photo talks to their phone, which is propped up in front of them so BOTH hands are free (handheld-free UGC framing, same place, same outfit), and says in French with a NEUTRAL PARISIAN accent from France (like a Paris content creator — absolutely NO Québécois, Canadian, Belgian, Swiss or southern accent, no Québécois diphthongs or vowels), directly to the camera: « ${line} »${pronunciation(line)} ${HOOK_PERFORMANCE} Standard French from France, never a Canadian or Québécois accent.`;
}
