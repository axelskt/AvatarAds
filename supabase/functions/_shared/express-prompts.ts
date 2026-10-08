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
function _expSpeechLock(p, seg){
  if(seg && seg.mute) return '. VOICE: she says NOTHING in this part — no new word, no sound from her mouth; natural silent continuation, mouth closed, small natural movements and expressions.';
  const line=_expQuotedLine(p);
  const kw=_expCommentKeyword(line);
  const _noEnd = false;   // Axel 02/10 : Omni Flash NE clôt PAS proprement (l'avatar parlait jusqu'à la coupe) → verrou de fin pour TOUS les moteurs
  // « SITE » en MAJUSCULES pousse Veo à ÉPELER (« S-site »). Dans la ligne PARLÉE on met le mot-clé en
  // minuscule → prononciation naturelle ; l'emphase (geste/voix) reste imposée par l'instruction plus bas.
  const lineSpoken = (kw && /^[A-ZÀ-Ÿ0-9]{2,}$/.test(kw)) ? line.split(kw).join(kw.toLowerCase()) : line;
  // Axel 07/10 : « le moins de blanc possible, voix fluide — des fois il marque des pauses alors qu'il n'y en a pas besoin »
  // (Omni étirait la phrase : blancs de 0,3-0,45 s au milieu des phrases, ça se voit que c'est de l'IA)
  return '. VOICE: accurate lip-sync, clear audible natural voice with casual dynamic intonation.'
    + ' FLUENT, CONTINUOUS DELIVERY: the words flow into each other like a real creator talking — NO unnecessary pause, NO dead air, NO hesitation and NO silent gap between words or between sentences; only the briefest natural breath where the punctuation truly needs one.'
    + (line ? ' THE ONLY WORDS SPOKEN IN THE ENTIRE CLIP, VERBATIM AND IN THIS LANGUAGE: « '+lineSpoken+' ».' : ' The person says ONLY the requested line, verbatim.')
    // Axel 08/10 : « il a inventé un mot » (H70 : « visible sur les réseaux DENTÉS ? ») → interdit explicite, partout dans la phrase
    + ' NEVER INVENT A WORD: every word spoken is a real word taken from the line, in the same order, pronounced exactly as written — no made-up word, no extra word, no extra syllable glued to a word, no deformed or repeated word, anywhere (start, middle or end of a sentence).'
    + (kw ? ' CALL-TO-ACTION KEYWORD « '+kw.toLowerCase()+' »: this is a keyword the viewer must TYPE in the comments. She says « '+kw.toLowerCase()+' » as ONE single, whole, FLUID word — its normal natural pronunciation, spoken smoothly in one breath — clearly and a bit LOUDER and a touch slower than the rest for emphasis, with a deliberate hand gesture (pointing down toward the comments) and a strong expressive face. NEVER spell it out, NEVER separate, announce or repeat its letters, NEVER split it into syllables, NEVER stutter, hesitate on it or repeat it (do NOT say it as separate letters, do NOT put a pause or an extra consonant before it, e.g. never « '+kw[0]+'… '+kw.toLowerCase()+' » nor « '+kw[0]+'-'+kw.toLowerCase()+' »); it comes out as one clean confident word. Never translate it, inflect it, pluralize it, add an article, or turn « '+kw+' » into a phrase or a place (do NOT say "un '+kw.toLowerCase()+'").' : '')
    + ' Nothing is said before the line (no greeting, no "euh", no intro, no invented word) and nothing after it (no extra sentence, no ad-lib, no trailing sound). Speech starts right at the first frame.'
    + ((seg && seg.i < seg.n-1) ? ' PACING: this is NOT the end of what she says — she delivers these words at a natural pace that fills the whole clip and keeps the flow going at the end (at most a short natural breath): no closing pause, no long silence, no wrap-up.'
      : _noEnd ? '' : ' CRITICAL ENDING: she must COMPLETE the whole sentence and land its final word BEFORE the clip ends (never cut off mid-word); pace the delivery so the last word finishes with about half a second to spare, then she STOPS talking, closes her mouth and holds a natural still, silent expression until the very end. The last ~0.5 second contains ABSOLUTELY no speech, no extra word, no filler and no trailing mouth movement or sound — total silence with a closed mouth.');
}
function _expSelfieCue(){
  return (window._expStyle==='realiste' || window._expStyle==='ugc')
    ? ', filmed as a handheld selfie held at arm’s length on a phone front camera, natural subtle camera shake and micro-jitter, the camera gently follows and stays locked on the person’s face, authentic amateur selfie feel, slightly imperfect framing'
    : '';
}
const _EXP_TEXLOCK = ". TEXTURE FIDELITY (CRITICAL): reproduce her face EXACTLY as in the reference photo — keep the real skin texture, visible pores, fine lines, natural imperfections, freckles or moles, under-eye area and every hair strand at the SAME level of detail and sharpness as the reference; the skin must look like real PHOTOGRAPHED skin, never rendered or plastic. Do NOT smooth, soften, blur, denoise, airbrush, retouch or beautify the skin; do NOT even out, brighten or unify the complexion; do NOT remove pores, texture, blemishes, redness, shine or natural shadows; do NOT slim the face or jaw, plump or enlarge the lips, widen the eyes, whiten the teeth or the eyes, thin the nose, smooth the hair or add any makeup, gloss or beauty filter. Match the reference photo's exact grain, micro-contrast and depth of field. Every single frame must look like the SAME real photo of the SAME real skin, only moving."
const _EXP_TEXLOCK_OMNI = ". IDENTITY 1:1 (this is an image-to-video animation of the reference photo): the input image IS the first frame — keep it pixel-for-pixel and ONLY add motion; do NOT re-render, repaint, regenerate, restyle or reinterpret the person. Her appearance stays 100 percent identical to the reference photo in EVERY frame: the exact same hair (same cut, color, parting, volume and individual strands and flyaways), the exact same facial features (eyes, eyebrows, nose, mouth shape, cheekbones, jawline and overall face shape), the exact same skin with its real texture, pores, fine lines, moles, blemishes, shine and shadows, and the exact same skin tone and undertone. The mouth keeps its exact natural shape, size and lip color and only moves to speak. Do NOT smooth, blur, soften, airbrush, retouch, beautify, brighten or even out the skin; do NOT lighten or shift the skin color; do NOT slim the face, plump the lips, enlarge or widen the eyes, whiten teeth or eyes, reshape the nose, or add makeup or any beauty filter. It must look like the SAME real photograph of the SAME real person, only moving — never a prettier, cleaner or smoother version."
const _EXP_IDLOCK = ". IMPORTANT: keep the EXACT same person throughout the ENTIRE video — same face, hairstyle, skin tone, eye color and facial features, photographically identical to the first frame; the identity must never morph, swap, distort, age, beautify or change, and the hands must stay natural; same person from the first frame to the last."
const _EXP_HOLDLOCK = ". If the person is holding a product or object, they keep it FIRMLY gripped in the hand for the ENTIRE video and ACTIVELY PRESENT it to the camera while speaking — raising it toward the lens, angling and turning it to show it off, gesturing with it and drawing attention to it, keeping it clearly visible and engaging with it dynamically: the hand never releases it, the object never leaves the hand, never floats, hovers, levitates, is dropped, set down or disappears — it stays physically held with believable weight and constant hand contact from the first frame to the last."
const _EXP_ENERGYLOCK = ". DELIVERY: the person speaks FAST, punchy and high-energy — a quick, lively, dynamic, upbeat tempo like a confident social-media hook; no slow, flat, dragging or monotone speech and NO dead pauses or silent gaps; expressive, animated hands and face, engaged and enthusiastic from start to finish, keeping the pace tight the whole time."
const _EXP_PRODUCTLOCK = ". PRODUCT FIDELITY (CRITICAL): if a product, object or item is shown, it must stay STRICTLY IDENTICAL to the uploaded reference image — the exact same shape, silhouette, proportions, geometry, materials, surface texture and finish, colors, patterns, logos, branding, labels and any text on it. Do NOT deform, warp, morph, melt, bend, stretch, squash, reshape, redesign, restyle, regenerate, re-texture, swap or transform the product in any way, and do NOT change its size, its details or any writing on it; keep every detail photographically faithful to the source image in EVERY frame. Only the person and the camera may move — the product itself never changes, distorts or transforms from the first frame to the last."
const _EXP_FRENCH = "LANGUAGE RULE (absolute priority): every spoken word in this video is in FRENCH (France), native accent, natural spoken French — never English, never any other language, even if the description below is written in English; translate any dialogue into natural French before speaking it. "
const _EXP_FRENCH_END = " REMINDER: the person speaks ONLY French (France) — no English word at all."
const _EXP_PIXEL_LOCK = "PIXEL-PERFECT FIDELITY (top priority, every frame): this video is the reference photo brought to life, nothing else. Keep the person 1:1 identical to the photo at the pixel level for the WHOLE clip — exact same identity, face, skin, skin texture, pores, fine lines, freckles, moles, stubble and individual hairs, exact same skin tone, exact same photographic grain, sensor noise, sharpness and lighting as the photo. The skin must NEVER become smoother, softer, waxier, shinier or more perfect than in the photo, not even slightly and not over time: no beautification, no airbrushing, no denoising, no plastic or CGI look, no AI-video sheen. COLOURS LOCKED TO THE PHOTO (Axel 02/10 : the video was adding a warm, saturated, contrasty filter): exact same white balance, colour temperature, exposure, brightness, contrast, saturation and skin hue as the reference photo — NO colour grading, NO filter, NO warming or orange skin, NO added contrast, vibrance, glow, haze, sharpening or cinematic look; the colours of frame 1 are the colours of the photo and they never drift. Frame 1 and the last frame must look like the same unedited phone camera. "
const _EXP_PRODUCT_VIDEO_LOCK = "PRODUCT 1:1 WITH THE INPUT IMAGE (every frame): any product shown stays EXACTLY as it appears in the input image — same colours, hue and saturation, same material and surface texture (matte, glossy, metallic, glass, plastic), same finish and reflections, same shape, proportions and cap, same logo, label layout and every printed letter, sharp and legible — even when it moves, tilts or turns. Never warp, blur, melt, recolour, simplify, redraw or re-letter it; if a side of the product is not visible in the input image, keep it turned so the visible side stays facing the camera. "
const styleMeta = { prompt: "authentic UGC selfie video, handheld front phone camera, natural daylight, real unretouched skin with visible pores and small natural imperfections, casual candid delivery, natural lifelike motion, slightly imperfect handheld framing, looks like a real creator filming themselves, NOT polished, NOT an ad, no plastic or waxy skin, no AI look PRODUCT RULE: if a product is visible, its packaging stays EXACTLY as in the source image for the whole clip — same label, same logo, same colours, every word of printed text letter-for-letter, sharp and legible, never redrawn, blurred, warped or re-spelled. ENDING RULE: the clip must end cleanly — the person finishes their current sentence (or the action completes), closes their mouth with a brief natural pause, and the video ends right there; never start a new sentence or gesture in the final second, never cut mid-word or mid-motion." }
// Omni Flash image → vidéo (photo de départ) : assemblage Express + enveloppe « CLEAN SHOT » de _expOmniImageToVideo.
export function expressOmniPrompt(prompt: string): string {
  window._expVeoModel = 'omni'; const _isOmni = true
  const _mkAnim = (pr, seg) => (_isOmni ? '' : _EXP_FRENCH)
      + ((seg && seg.i > 0) ? 'CONTINUATION OF THE PREVIOUS CLIP: this extends the SAME continuous take seamlessly from its last frame — same person, same face, same outfit, same place, same light, same framing and camera; no cut, no restart, no new greeting; she simply carries on in the same voice and tone. ' : '')
      + ((pr + ', ' + styleMeta.prompt + ', natural realistic motion, authentic real handheld footage, believable physics, looks like a real phone video, NOT an AI render' + _expSelfieCue()))
      + _expEnvLock(pr)
      + (window._expVoice==='native' ? _expSpeechLock(pr, seg) : '')
      + ((window._expStyle==='realiste' || window._expStyle==='ugc') ? _EXP_TEXLOCK : '')
      + ((_isOmni && (window._expStyle==='realiste' || window._expStyle==='ugc')) ? _EXP_TEXLOCK_OMNI : '')   // Omni i2v : verrou 1:1 renforcé (photo = 1re frame, on anime, on ne redessine pas)
      + _EXP_IDLOCK + _EXP_HOLDLOCK + _EXP_ENERGYLOCK + _EXP_PRODUCTLOCK
      + (_isOmni ? '' : _EXP_FRENCH_END);
  const animPrompt = _mkAnim(prompt, null)
  return (function (prompt) { const _omniPrompt = _EXP_FRENCH + _EXP_PIXEL_LOCK + _EXP_PRODUCT_VIDEO_LOCK + "CLEAN SHOT, ZERO TEXT. Never render, write, print, spell out, display or overlay ANY text, letters, words, captions, subtitles, labels or watermarks anywhere in the frame — not on the clothing, not on the product, not floating in the air, not in the background, nowhere. Every word from the script is SPOKEN OUT LOUD only and must NEVER appear as writing on screen. " + prompt + " (Hard rule, do not break: absolutely no on-screen text, captions or written words — audio speech only, clean visuals only.)" + _EXP_FRENCH_END; return _omniPrompt })(animPrompt)
}
// Photo de départ générée quand il n'y a pas d'image (Express : prompt + style ugc + « no text… »), texte de l'app.
export function expressImagePrompt(prompt: string): string {
  const imgPrompt = prompt + ', ' + styleMeta.prompt + ', no text, no watermark, high quality';
  return imgPrompt
}
// Qualité HAUTE = palier « 4K » de l'app (Axel 02/10) : image Premium puis Nano Banana Pro 4K avec CES consignes, mot pour mot.
export const IMG_REALISM_EDIT = "Keep the EXACT same person, identity, face, pose, framing, composition, clothing and background — do NOT change the scene or the layout. ONLY change the rendering so the image looks like a genuine real photograph taken with a real camera or phone, completely indistinguishable from a real photo and clearly NOT AI-generated. Add highly realistic skin with visible pores and natural skin texture, subtle freckles and tiny blemishes, and clearly visible fine peach fuzz / vellus hair across the cheeks, jaw, upper lip and hairline edges catching the light for a natural soft fuzz, natural skin-tone variation and slight redness, realistic under-eye texture; a natural detailed hairline with fine baby hairs and individual strands; realistic eyebrows with individual hairs, fine individual eyelashes, and highly detailed eyes — a sharp iris with visible fibrous texture and radial striations, a subtle darker limbal ring, crisp catchlights, a moist reflective eye surface and natural waterline; natural lip texture with fine vertical lines; realistic skin detail on any visible body part (arms, hands, legs). CRITICAL — this detail must be RECOVERED, never INVENTED by beautifying: NEVER smooth or even out the skin, NEVER remove blemishes, pimples, redness, shine or under-eye shadows, NEVER thicken or reshape eyebrows or eyelashes, NEVER whiten teeth or eyes, NEVER slim or reshape any facial feature, NEVER add makeup, glow or any beauty-filter / portrait-retouch look. Keep the original softness, the original depth of field and the original sensor grain — do not sharpen what was out of focus and do not denoise. Keep the original white balance, exposure and contrast, and the natural asymmetry of the face. Remove every plastic, waxy, airbrushed, over-smoothed, glossy or CGI look. Keep natural human imperfections and true-to-life colors. The final result must look like a real, unedited photograph."
export const IMG_TEXT_FIDELITY = " Preserve ALL visible text from the reference image EXACTLY as it appears — same words, same spelling, same language, same fonts and same placement on packaging, labels and logos. Never invent, translate, rewrite or distort any text."
export const NB_MODEL = "gemini-3-pro-image"
// Images de PERSONNE réalistes : bloc réalisme de l'app (photo amateur + tenue correcte SFW), mot pour mot.
export const IMG_REALISM_SUFFIX = ". Shot as a real candid amateur photo taken on a phone — NOT a professional studio portrait, no beauty retouching. Natural realistic human skin with fine natural texture and normal pores, subtle imperfections and slightly uneven skin tone, fine peach fuzz, a natural hairline with a few flyaways, individual eyebrow hairs and eyelashes, natural facial asymmetry, an authentic relaxed candid expression, believable natural lighting and true-to-life colors. The ENTIRE background is sharp and in focus (deep depth of field, no background blur, no bokeh, no lens blur). Frame the person fairly close so the face is large, prominent and richly detailed in the frame — a chest-up shot or closer, never a tiny or far-away face — unless a clearly wider or full-body composition is requested. Keep it natural, clean and flattering — never plastic, waxy, airbrushed, over-smoothed, over-sharpened, blotchy or over-textured, no exaggerated or enlarged pores, no heavy blemishes. It must look like a genuine unedited real photograph, clearly NOT AI-generated, NOT 3D, NOT CGI, no digital-art look, no beauty filter. Keep it strictly SFW and modest: the person stays fully and tastefully dressed with the chest, cleavage and torso covered by normal clothing — no nudity, no lingerie or underwear, no swimwear or cleavage emphasis and no sexualized or suggestive posing, even if the request contains words like \"sexy\", \"hot\" or \"belle\"."
// OMNI — édition vidéo par prompt (module Omni de l'app) : _omniBuildPrompt mot pour mot, kill-switch logo compris.
const _OMNI_LOGO_FIDELITY = true;
export function omniEditPrompt(p: string): string{
  let s=String(p||'').trim();
  const hasKeep=/(keep everything|reste (identique|inchang)|le reste (identique|inchang)|garde le reste|inchang[ée]|sans (rien )?(d\'autre|autre) chang|only change|ne change (que|rien d))/i.test(s);
  if(!hasKeep){
    if(!/[.!?…]$/.test(s)) s+='.';
    // Anglais : la formule exacte documentée par Google, la plus fiable. Gemini est
    // multilingue, donc un prompt FR + cette clause EN cohabitent sans souci.
    s+=' Keep everything else in the video exactly the same.';
  }
  // MOUVEMENT (Axel 04/10, avant/après « Clio → GT3 RS ») : un panoramique ALLER-RETOUR de la source ressortait en UN seul
  // panoramique, avec un départ et une arrivée différents. La trajectoire de caméra est donc imposée moment par moment — en
  // une phrase (doc Google : prompts simples), sauf si l'utilisateur l'a déjà demandé lui-même.
  if(!/(same (camera )?(motion|movement|trajectory|path)|m[êe]me mouvement|m[êe]me trajectoire)/i.test(s)){
    s+=' The camera motion must match the source video EXACTLY, moment by moment: same starting view, same pans, turns and direction changes at the same times and the same speed, same ending view — follow the original camera path 1:1, never a new or simplified one.';
  }
  // Préservations CIBLÉES (retours Axel 13/09) : la POSITION/placement et le CADRAGE ne changent pas
  // (il mettait le sujet côté conducteur au lieu de passager), et rien d'inventé.
  // ⚠️ Diagnostic 15/09 : la phrase « reproduce a real brand's authentic name and logo… » ajoutée le
  // 13/09 18h10 (commit e3a890d) était collée à CHAQUE prompt → le filtre marques/trademark de Gemini
  // (« sensitive words violate Google's Prohibited Use policy ») bloquait TOUTES les requêtes, même sans
  // marque (montre, voiture, porte-clés…). On RETIRE tout langage marque/logo/badge et on neutralise
  // l'anti-hallucination (texte/graphismes génériques, sans « logo »). Court, ajouté une seule fois.
  if(!/(same (seat|position|side|placement)|do not (add|invent)|n'invente|sans inventer)/i.test(s)){
    s+=' Keep every subject and object in their EXACT original position, side, seat and placement — never move the subject to a different seat or the opposite side — and keep the same camera angle and framing.';
    s+=' Do NOT add, invent, fabricate or hallucinate any extra logo, emblem, badge or written text that is not in the source OR implied by the request.';
    // ⚠️ FIDÉLITÉ LOGO (Axel 15/09, choix C assumé — testé OK avec Patek Philippe). Gaté par _OMNI_LOGO_FIDELITY (kill-switch).
    if(_OMNI_LOGO_FIDELITY) s+=' Any lettering, badge, model name, emblem or logo that DOES appear (including one the request asks for) MUST use its EXACT official correct spelling and be rendered crisp, sharp, straight and fully legible — never garbled, misspelled, warped, blurred, doubled, gibberish or made-up fantasy characters. If a real brand or model is requested, reproduce ONLY its authentic real name and logo exactly as officially written; when unsure of the exact wording, leave that text out rather than invent it.';
  }
  return s;
}
// MOTION CONTROL (module de l'app) : instruction de mouvement (celle de l'utilisateur, sinon celle de l'app) + verrous
// identité / geste / cadrage / décor / caméra / réalisme, tronqué à 2 400 caractères comme dans _mcGenerate.
export function motionControlPrompt(o: { instruction?: string; camFollow?: boolean; keepVidBg?: boolean }): string {
  const window = { _mcPrompt: String(o.instruction || '').trim(), _mcCamFollow: o.camFollow !== false, _mcKeepVidBg: !!o.keepVidBg }
  const _mcMotion = window._mcPrompt || 'The character reproduces the EXACT motion, gestures, head and body movement AND the CAMERA MOVEMENT of the reference video — follow the reference camera work faithfully: match its angle (low-angle / high-angle), its tilt and its real camera moves. Natural, realistic.';
  const _mcBgTxt = window._mcKeepVidBg
      ? ' Keep the EXACT same background, scene and environment as the REFERENCE VIDEO: only replace the person with the provided character — everything behind them stays identical to the original video.'
      : ' Keep the EXACT same background, scene and environment as the provided image: do not change, replace, blur, crop out or regenerate anything behind the character — the decor must stay identical.';
  const _mcCamTxt = window._mcCamFollow
      ? ' Handheld camera held at arm\'s length, with subtle organic shake, micro-jitter and natural breathing motion that reacts to the character\'s movements — a realistic hand-held selfie feel, slightly unstable and alive, NOT a locked tripod nor a smooth gimbal.'
      : '';
  const _mcRealTxt = ' Photorealistic UGC quality: REAL skin — visible pores, fine peach fuzz, natural body hair, small blemishes, freckles and moles exactly where they are, natural hairline with baby hairs, uneven skin tone and slight shine; never plastic, smoothed or airbrushed. Natural hair strands and fabric detail, correct hands and fingers, consistent lighting and shadows, sharp 4K detail, no warping, no flicker.';
  const _mcGestTxt = ' GESTURE REPLICATION: reproduce the reference HAND poses EXACTLY — same fingers extended or curled, same gesture, trajectory and timing. If the reference points with an index finger, the character points with the index finger — never a fist, a pinch or an invented gesture. Hands anatomically correct.';
  const _mcSafeTxt = ' FRAMING: the face stays inside the frame edges (never cropped out by the frame). Hands may pass close to or in front of the face whenever the reference does — reproduce that exactly. DISTANCE RULE: the subject-to-camera distance and the on-screen head size must match the REFERENCE VIDEO at every moment — the head keeps the SAME fraction of the frame as in the reference; never zoom in closer than the reference, never enlarge the face or crop tighter than the reference does. Follow the reference camera movement (including its real push-in) without ever exceeding it; do NOT force a static, perfectly centered, locked shot.';
  const _mcId = ' CRUCIAL: keep the EXACT same identity as the provided character image — same face, hairstyle, skin tone, body and clothing. Same person throughout: never morph, swap, beautify or change the face or the outfit.' + _mcGestTxt + _mcSafeTxt + _mcBgTxt + _mcCamTxt + _mcRealTxt;
  return (_mcMotion + _mcId).slice(0, 2400)
}
// Veo 3.1 Lite (sans photo) : même assemblage Express que l'app, moteur Veo (verrou de fin de parole compris).
export function expressVeoPrompt(prompt: string): string {
  window._expVeoModel = 'lite'; const _isOmni = false
  const _mkAnim = (pr, seg) => (_isOmni ? '' : _EXP_FRENCH)
      + ((seg && seg.i > 0) ? 'CONTINUATION OF THE PREVIOUS CLIP: this extends the SAME continuous take seamlessly from its last frame — same person, same face, same outfit, same place, same light, same framing and camera; no cut, no restart, no new greeting; she simply carries on in the same voice and tone. ' : '')
      + ((pr + ', ' + styleMeta.prompt + ', natural realistic motion, authentic real handheld footage, believable physics, looks like a real phone video, NOT an AI render' + _expSelfieCue()))
      + _expEnvLock(pr)
      + (window._expVoice==='native' ? _expSpeechLock(pr, seg) : '')
      + ((window._expStyle==='realiste' || window._expStyle==='ugc') ? _EXP_TEXLOCK : '')
      + ((_isOmni && (window._expStyle==='realiste' || window._expStyle==='ugc')) ? _EXP_TEXLOCK_OMNI : '')   // Omni i2v : verrou 1:1 renforcé (photo = 1re frame, on anime, on ne redessine pas)
      + _EXP_IDLOCK + _EXP_HOLDLOCK + _EXP_ENERGYLOCK + _EXP_PRODUCTLOCK
      + (_isOmni ? '' : _EXP_FRENCH_END);
  const animPrompt = _mkAnim(prompt, null)
  return animPrompt
}
