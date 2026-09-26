// GÉNÉRÉ par tools/gen-omnihuman-prompts.mjs depuis shared/omnihuman-prompts.json — ne pas éditer à la main (edge functions).
// Prompt OmniHuman 1.5 (version 2026-09-26a) : anglais, 300 caractères maximum (limite kie). still → courte · alive + hook/cta → vivante_(mains|sans_mains) · sinon → standard_(mains|sans_mains). Mains = détectées sur la photo (_mtDetectHands dans l'app) ; sans détection (worker, MCP) → sans mains.
export type OmnihumanPromptKey = 'standard_mains' | 'standard_sans_mains' | 'courte' | 'vivante_mains' | 'vivante_sans_mains'
export const OMNIHUMAN_PROMPT_MAX = 300
export const OMNIHUMAN_PROMPTS_VERSION = '2026-09-26a'
export const OMNIHUMAN_PROMPTS: Record<OmnihumanPromptKey, string> = {
 "standard_mains": "Selfie at arm's length; the camera keeps the photo's framing and distance. The person talks sincerely to the camera, with natural blinks, small head nods and a relaxed gesture of the visible hand on key words. Light and background stay the same. After the last word, the lips close.",
 "standard_sans_mains": "Selfie close-up at arm's length; the camera keeps the photo's framing and distance. The person talks sincerely to the camera, with natural blinks, small head nods and subtle eyebrow raises on key words. Light and background stay the same. After the last word, the lips close.",
 "courte": "Selfie close-up, same framing as the photo. The person talks to the camera, calm and sincere, with natural blinks and small head nods. After the last word, the lips close.",
 "vivante_mains": "Handheld selfie at arm's length with a slight natural sway; the face stays large in frame. The person talks to the camera with conviction, nodding, raising the eyebrows and gesturing with the visible hand on key words. The background stays calm. After the last word, the lips close.",
 "vivante_sans_mains": "Handheld selfie at arm's length with a slight natural sway; the face stays large in frame. The person talks to the camera with conviction, nodding, leaning in slightly and raising the eyebrows on key words. The background stays calm. After the last word, the lips close."
}

export function omnihumanPrompt(o: { hands?: boolean; level?: string; role?: string } = {}): string {
  const P = OMNIHUMAN_PROMPTS, hands = o.hands === true;
  if (o.level === 'still') return P.courte;
  if (o.level === 'alive' && (o.role === 'hook' || o.role === 'cta')) return hands ? P.vivante_mains : P.vivante_sans_mains;
  return hands ? P.standard_mains : P.standard_sans_mains;
}
// Coupe tout prompt (surcharge du compte propriétaire, plan.lipsyncPrompt…) à OMNIHUMAN_PROMPT_MAX : kie refuse au-delà.
// Coupe sur le dernier espace quand il reste au moins 60 % du texte (pas de mot tronqué), sinon net.
export function clampOmnihumanPrompt(s: unknown): string {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (t.length <= OMNIHUMAN_PROMPT_MAX) return t;
  let c = t.slice(0, OMNIHUMAN_PROMPT_MAX);
  const sp = c.lastIndexOf(' ');
  if (sp >= OMNIHUMAN_PROMPT_MAX * 0.6) c = c.slice(0, sp);
  return c.trim();
}
