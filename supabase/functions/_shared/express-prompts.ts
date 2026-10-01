// @ts-nocheck — GÉNÉRÉ par tools/gen-express-prompts.mjs depuis app/index.html — ne pas éditer à la main.
// Prompt Express Omni Flash « UGC réel » de l'app, rejoué à l'identique pour le MCP (style ugc, voix native, Omni).
const window = { _expStyle: 'ugc', _expVoice: 'native', _expVeoModel: 'omni' }
function _expQuotedLine(p){ const m=String(p||'').match(/[«"“”]([^«»"“”]{3,})[»"“”]/); return m ? m[1].replace(/\s+/g,' ').trim() : ''; }
function _expCommentKeyword(line){
  const t=String(line||'');
  let m=t.match(/(?:comment(?:e|er|ez|es)?|[ée]cri[st]|tape[zr]?)\s+(?:(?:le|ce)\s+mot\s+|the\s+word\s+)?[«"“'']?([\p{L}][\p{L}0-9-]{1,})[»"”'']?/iu);
  if(m && !/^(le|la|les|ce|the|word|mot|en|et|si|tu|me)$/i.test(m[1])) return m[1];
  m=t.match(/(?<![\p{L}])([A-ZÀ-Ÿ][A-ZÀ-Ÿ0-9]{1,})(?![\p{L}])/u);   // placeholder tout en majuscules (SITE)
  return m ? m[1] : '';
}
function _expWantsScenes(p){ return /transition|\bcut\b|multi[- ]?sc[èe]ne|sc[èe]ne\s*2|deuxi[èe]me sc[èe]ne|\bsnap\b|claque|d[ée]zoom|\bzoom|nouveau (lieu|d[ée]cor)|chang\w* de (lieu|d[ée]cor|plan)/i.test(String(p||'')); }
function _expEnvLock(p){
  if(_expWantsScenes(p)) return '';
  return '. ENVIRONMENT LOCK: the setting, background, lighting, framing and camera position are EXACTLY those of the reference image and stay UNCHANGED for the entire clip — one continuous take, no cut, no scene change, no new location, no camera travel, nothing appears or disappears in the background';
}
function _expSpeechLock(p){
  const line=_expQuotedLine(p);
  const kw=_expCommentKeyword(line);
  const _noEnd = (window._expVeoModel==='omni');   // Omni Flash clôt la fin naturellement → pas de verrou de fin
  // « SITE » en MAJUSCULES pousse Veo à ÉPELER (« S-site »). Dans la ligne PARLÉE on met le mot-clé en
  // minuscule → prononciation naturelle ; l'emphase (geste/voix) reste imposée par l'instruction plus bas.
  const lineSpoken = (kw && /^[A-ZÀ-Ÿ0-9]{2,}$/.test(kw)) ? line.split(kw).join(kw.toLowerCase()) : line;
  return '. VOICE: accurate lip-sync, clear audible natural voice with casual dynamic intonation.'
    + (line ? ' THE ONLY WORDS SPOKEN IN THE ENTIRE CLIP, VERBATIM AND IN THIS LANGUAGE: « '+lineSpoken+' ».' : ' The person says ONLY the requested line, verbatim.')
    + (kw ? ' CALL-TO-ACTION KEYWORD « '+kw.toLowerCase()+' »: this is a keyword the viewer must TYPE in the comments. She says « '+kw.toLowerCase()+' » as ONE single, whole, FLUID word — its normal natural pronunciation, spoken smoothly in one breath — clearly and a bit LOUDER and a touch slower than the rest for emphasis, with a deliberate hand gesture (pointing down toward the comments) and a strong expressive face. NEVER spell it out, NEVER separate, announce or repeat its letters, NEVER split it into syllables, NEVER stutter, hesitate on it or repeat it (do NOT say it as separate letters, do NOT put a pause or an extra consonant before it, e.g. never « '+kw[0]+'… '+kw.toLowerCase()+' » nor « '+kw[0]+'-'+kw.toLowerCase()+' »); it comes out as one clean confident word. Never translate it, inflect it, pluralize it, add an article, or turn « '+kw+' » into a phrase or a place (do NOT say "un '+kw.toLowerCase()+'").' : '')
    + ' Nothing is said before the line (no greeting, no "euh", no intro, no invented word) and nothing after it (no extra sentence, no ad-lib, no trailing sound). Speech starts right at the first frame.'
    + (_noEnd ? '' : ' CRITICAL ENDING: she must COMPLETE the whole sentence and land its final word BEFORE the clip ends (never cut off mid-word); pace the delivery so the last word finishes with about half a second to spare, then she STOPS talking, closes her mouth and holds a natural still, silent expression until the very end. The last ~0.5 second contains ABSOLUTELY no speech, no extra word, no filler and no trailing mouth movement or sound — total silence with a closed mouth.');
}
function _expSelfieCue(){
  return (window._expStyle==='realiste' || window._expStyle==='ugc')
    ? ', filmed as a handheld selfie held at arm’s length on a phone front camera, natural subtle camera shake and micro-jitter, the camera gently follows and stays locked on the person’s face, authentic amateur selfie feel, slightly imperfect framing'
    : '';
}
const _EXP_TEXLOCK = ". TEXTURE FIDELITY (CRITICAL): reproduce her face EXACTLY as in the reference photo — keep the real skin texture, visible pores, fine lines, natural imperfections, freckles or moles, under-eye area and every hair strand at the SAME level of detail and sharpness as the reference; the skin must look like real PHOTOGRAPHED skin, never rendered or plastic. Do NOT smooth, soften, blur, denoise, airbrush, retouch or beautify the skin; do NOT even out, brighten or unify the complexion; do NOT remove pores, texture, blemishes, redness, shine or natural shadows; do NOT slim the face or jaw, plump or enlarge the lips, widen the eyes, whiten the teeth or the eyes, thin the nose, smooth the hair or add any makeup, gloss or beauty filter. Match the reference photo\\'s exact grain, micro-contrast and depth of field. Every single frame must look like the SAME real photo of the SAME real skin, only moving."
const _EXP_TEXLOCK_OMNI = ". IDENTITY 1:1 (this is an image-to-video animation of the reference photo): the input image IS the first frame — keep it pixel-for-pixel and ONLY add motion; do NOT re-render, repaint, regenerate, restyle or reinterpret the person. Her appearance stays 100 percent identical to the reference photo in EVERY frame: the exact same hair (same cut, color, parting, volume and individual strands and flyaways), the exact same facial features (eyes, eyebrows, nose, mouth shape, cheekbones, jawline and overall face shape), the exact same skin with its real texture, pores, fine lines, moles, blemishes, shine and shadows, and the exact same skin tone and undertone. The mouth keeps its exact natural shape, size and lip color and only moves to speak. Do NOT smooth, blur, soften, airbrush, retouch, beautify, brighten or even out the skin; do NOT lighten or shift the skin color; do NOT slim the face, plump the lips, enlarge or widen the eyes, whiten teeth or eyes, reshape the nose, or add makeup or any beauty filter. It must look like the SAME real photograph of the SAME real person, only moving — never a prettier, cleaner or smoother version."
const _EXP_IDLOCK = ". IMPORTANT: keep the EXACT same person throughout the ENTIRE video — same face, hairstyle, skin tone, eye color and facial features, photographically identical to the first frame; the identity must never morph, swap, distort, age, beautify or change, and the hands must stay natural; same person from the first frame to the last."
const _EXP_HOLDLOCK = ". If the person is holding a product or object, they keep it FIRMLY gripped in the hand for the ENTIRE video and ACTIVELY PRESENT it to the camera while speaking — raising it toward the lens, angling and turning it to show it off, gesturing with it and drawing attention to it, keeping it clearly visible and engaging with it dynamically: the hand never releases it, the object never leaves the hand, never floats, hovers, levitates, is dropped, set down or disappears — it stays physically held with believable weight and constant hand contact from the first frame to the last."
const _EXP_ENERGYLOCK = ". DELIVERY: the person speaks FAST, punchy and high-energy — a quick, lively, dynamic, upbeat tempo like a confident social-media hook; no slow, flat, dragging or monotone speech and NO dead pauses or silent gaps; expressive, animated hands and face, engaged and enthusiastic from start to finish, keeping the pace tight the whole time."
const _EXP_PRODUCTLOCK = ". PRODUCT FIDELITY (CRITICAL): if a product, object or item is shown, it must stay STRICTLY IDENTICAL to the uploaded reference image — the exact same shape, silhouette, proportions, geometry, materials, surface texture and finish, colors, patterns, logos, branding, labels and any text on it. Do NOT deform, warp, morph, melt, bend, stretch, squash, reshape, redesign, restyle, regenerate, re-texture, swap or transform the product in any way, and do NOT change its size, its details or any writing on it; keep every detail photographically faithful to the source image in EVERY frame. Only the person and the camera may move — the product itself never changes, distorts or transforms from the first frame to the last."
const _EXP_FRENCH = "LANGUAGE RULE (absolute priority): every spoken word in this video is in FRENCH (France), native accent, natural spoken French — never English, never any other language, even if the description below is written in English; translate any dialogue into natural French before speaking it. "
const _EXP_FRENCH_END = " REMINDER: the person speaks ONLY French (France) — no English word at all."
const styleMeta = { prompt: "authentic UGC selfie video, handheld front phone camera, natural daylight, real unretouched skin with visible pores and small natural imperfections, casual candid delivery, natural lifelike motion, slightly imperfect handheld framing, looks like a real creator filming themselves, NOT polished, NOT an ad, no plastic or waxy skin, no AI look PRODUCT RULE: if a product is visible, its packaging stays EXACTLY as in the source image for the whole clip — same label, same logo, same colours, every word of printed text letter-for-letter, sharp and legible, never redrawn, blurred, warped or re-spelled. ENDING RULE: the clip must end cleanly — the person finishes their current sentence (or the action completes), closes their mouth with a brief natural pause, and the video ends right there; never start a new sentence or gesture in the final second, never cut mid-word or mid-motion." }
// Omni Flash image → vidéo (photo de départ) : assemblage Express + enveloppe « CLEAN SHOT » de _expOmniImageToVideo.
export function expressOmniPrompt(prompt: string): string {
  window._expVeoModel = 'omni'; const _isOmni = true
  const animPrompt = (_isOmni ? '' : _EXP_FRENCH) + ((prompt + ', ' + styleMeta.prompt + ', natural realistic motion, authentic real handheld footage, believable physics, looks like a real phone video, NOT an AI render' + _expSelfieCue()))
      + _expEnvLock(prompt)
      + (window._expVoice==='native' ? _expSpeechLock(prompt) : '')
      + ((window._expStyle==='realiste' || window._expStyle==='ugc') ? _EXP_TEXLOCK : '')
      + ((_isOmni && (window._expStyle==='realiste' || window._expStyle==='ugc')) ? _EXP_TEXLOCK_OMNI : '')   // Omni i2v : verrou 1:1 renforcé (photo = 1re frame, on anime, on ne redessine pas)
      + _EXP_IDLOCK + _EXP_HOLDLOCK + _EXP_ENERGYLOCK + _EXP_PRODUCTLOCK
      + (_isOmni ? '' : _EXP_FRENCH_END);
  return (function (prompt) { const _omniPrompt = _EXP_FRENCH + "CLEAN SHOT, ZERO TEXT. Never render, write, print, spell out, display or overlay ANY text, letters, words, captions, subtitles, labels or watermarks anywhere in the frame — not on the clothing, not on the product, not floating in the air, not in the background, nowhere. Every word from the script is SPOKEN OUT LOUD only and must NEVER appear as writing on screen. " + prompt + " (Hard rule, do not break: absolutely no on-screen text, captions or written words — audio speech only, clean visuals only.)" + _EXP_FRENCH_END; return _omniPrompt })(animPrompt)
}
// Photo de départ générée quand il n'y a pas d'image (Express : prompt + style ugc + « no text… »), texte de l'app.
export function expressImagePrompt(prompt: string): string {
  const imgPrompt = prompt + ', ' + styleMeta.prompt + ', no text, no watermark, high quality';
  return imgPrompt
}
// Images de PERSONNE réalistes : bloc réalisme de l'app (photo amateur + tenue correcte SFW), mot pour mot.
export const IMG_REALISM_SUFFIX = ". Shot as a real candid amateur photo taken on a phone — NOT a professional studio portrait, no beauty retouching. Natural realistic human skin with fine natural texture and normal pores, subtle imperfections and slightly uneven skin tone, fine peach fuzz, a natural hairline with a few flyaways, individual eyebrow hairs and eyelashes, natural facial asymmetry, an authentic relaxed candid expression, believable natural lighting and true-to-life colors. The ENTIRE background is sharp and in focus (deep depth of field, no background blur, no bokeh, no lens blur). Frame the person fairly close so the face is large, prominent and richly detailed in the frame — a chest-up shot or closer, never a tiny or far-away face — unless a clearly wider or full-body composition is requested. Keep it natural, clean and flattering — never plastic, waxy, airbrushed, over-smoothed, over-sharpened, blotchy or over-textured, no exaggerated or enlarged pores, no heavy blemishes. It must look like a genuine unedited real photograph, clearly NOT AI-generated, NOT 3D, NOT CGI, no digital-art look, no beauty filter. Keep it strictly SFW and modest: the person stays fully and tastefully dressed with the chest, cleavage and torso covered by normal clothing — no nudity, no lingerie or underwear, no swimwear or cleavage emphasis and no sexualized or suggestive posing, even if the request contains words like \"sexy\", \"hot\" or \"belle\"."
// Veo 3.1 Lite (sans photo) : même assemblage Express que l'app, moteur Veo (verrou de fin de parole compris).
export function expressVeoPrompt(prompt: string): string {
  window._expVeoModel = 'lite'; const _isOmni = false
  const animPrompt = (_isOmni ? '' : _EXP_FRENCH) + ((prompt + ', ' + styleMeta.prompt + ', natural realistic motion, authentic real handheld footage, believable physics, looks like a real phone video, NOT an AI render' + _expSelfieCue()))
      + _expEnvLock(prompt)
      + (window._expVoice==='native' ? _expSpeechLock(prompt) : '')
      + ((window._expStyle==='realiste' || window._expStyle==='ugc') ? _EXP_TEXLOCK : '')
      + ((_isOmni && (window._expStyle==='realiste' || window._expStyle==='ugc')) ? _EXP_TEXLOCK_OMNI : '')   // Omni i2v : verrou 1:1 renforcé (photo = 1re frame, on anime, on ne redessine pas)
      + _EXP_IDLOCK + _EXP_HOLDLOCK + _EXP_ENERGYLOCK + _EXP_PRODUCTLOCK
      + (_isOmni ? '' : _EXP_FRENCH_END);
  return animPrompt
}
