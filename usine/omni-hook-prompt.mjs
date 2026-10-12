// Prompt des hooks Omni (A3, A4…) pour l'usine — Axel 12/10 : « l'avatar arrive brut ». Réf. @devinjatho (« You Will Never
// Go Viral If… ») : arrivée pleine d'émotion, élocution fluide, il parle BEAUCOUP avec les mains, l'émotion évolue.
// Réservé à l'usine (MCP generate_video) : le style « UGC réel » de l'app n'est PAS modifié pour les clients.
// Règles déjà en place à garder : français de France sans accent canadien/québécois, débit continu sans blanc,
// jamais de mot inventé, fin propre (voir express-prompts.ts).
export const HOOK_PERFORMANCE = [
  'ENTRANCE (first 0.5 s): the clip opens already in motion, never on a frozen face — the person leans slightly toward the phone with raised eyebrows, wide expressive eyes and an excited half-smile, as if they just discovered something incredible and can not wait to tell it; they start speaking within the first 0.3 s.',
  'HANDS: they talk a lot with BOTH hands, visible in frame at chest height — open palms toward the camera, counting on fingers, pointing at the lens, framing an idea with both hands, a quick emphatic gesture on every key word; the hands keep moving naturally for the whole clip, never resting out of frame.',
  'EMOTION: strong, readable emotion that evolves with the sentence — surprise and excitement at the start, then conviction, a knowing smile or a raised eyebrow on the punchline; animated face, head nods and small head tilts.',
  'DELIVERY: confident, fluid and well articulated like a charismatic content creator, energetic conversational rhythm, every word crisp and clear.'
].join(' ');

// Réplique + performance, dans l'ordre attendu par le MCP (la réplique entre « … » est dite mot pour mot).
export function hookPrompt(line) {
  return `The person in the photo talks to their phone, which is propped up in front of them so BOTH hands are free (handheld-free UGC framing, same place, same outfit), and says in French, directly to the camera: « ${line} » ${HOOK_PERFORMANCE} Standard French from France, never a Canadian or Québécois accent.`;
}
