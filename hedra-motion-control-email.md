Objet : API access to Kling Motion Control models (image + driving video)

Hi Hedra team,

We're building on top of the Hedra API (we already use `/web-app/public/generations`
for lip-sync with Character-3, model `d1dd37a3-e39a-4854-a298-6510289f9cf2`).

Our billing/credits page lists these models:
  - Kling 2.6 Motion Control Standard — 8 credits/s
  - Kling 2.6 Motion Control Pro — 16 credits/s
  - Kling V3 Motion Control Standard — 25 credits/s
  - Kling V3 Motion Control Pro — 35 credits/s

But when we call `GET /web-app/public/models`, the only Kling models returned are
I2V / T2V / IE2V / IR2V — none of them accepts a driving/reference **video** input
(no `video` slot, no "motion control" mode). So we can't figure out how to run the
"Motion Control" models (a character image reproducing the motion of a reference video)
through the API.

Could you tell us:
  1. The `ai_model_id` for "Kling 2.6 Motion Control" (Standard and Pro) and
     "Kling V3 Motion Control" (Standard and Pro).
  2. The exact `/generations` payload — specifically which field carries the
     **reference/driving video** and which carries the **character image**
     (the lip-sync one uses `audio_id` + `start_keyframe_id`; motion control
     presumably uses a video asset instead of audio).
  3. Any resolution / duration constraints for these models.

If Motion Control is not yet exposed on the public API, is it on the roadmap, and
is there a timeline?

Thanks a lot,
Axel — AvatarAds
