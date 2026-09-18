# Spike 4e — Multi-frame evidence acceptance

## Current decision

**PASS — real YouTube nearby capture and evidence delivery are proven. Keep PR #26 open and unmerged.**

The final run captured the selected frame at 455.0s and two neighbors, delivered all three to the evidence pipeline, accepted readable text from the next frame for the same watch, and restored 455.0s paused. Searchable and identity confidence both remained 99%. This supersedes the previous report's unproven YouTube gate.

## Exact blocker and scoped fix

Two copies of an incomplete-identity predicate blocked explicit requests:

1. The extension hid **Improve with nearby frames** when primary identity/searchability were at least 80% and brand, model and color were present. The earlier real YouTube results met that condition, so capture was never invoked.
2. After exposing the action, the real YouTube player captured 454.5s and455.5s and restored 455.0s paused. However, `analyzeWithNearbyFrames` applied the same predicate and returned a one-frame merge without calling either comparison adapter. The live response reported `frames_used: 1` despite two `captured` attempts. New API/unit regressions reproduced zero comparison calls for a complete primary identity.

The fix removes these confidence-based activation gates for explicit requests. It still allows one bounded improvement action per primary result, retains the two-neighbor limit and all capture, same-object, conflict and confidence safeguards. No seek implementation, targeting, provider prompt, resolver or commerce logic changed in this follow-up.

The regression for action availability failed before the UI fix. The complete-primary API/unit regressions failed before the backend fix. They pass afterward, including evidence delivery through both Gemini and Groq adapters and unchanged confidence on agreement.

## Real YouTube verification

- Video: [Casio F91W — Unboxing and First impressions](https://www.youtube.com/watch?v=IpQd3XH0_EQ&t=455s). Reused the existing test video; no new video search.
- Dedicated Chrome for Testing profile, loaded extension, visible page, ordinary readable blob/MSE video, `mediaKeys: false`.
- Real deployed Gemini Worker; no model responses mocked and no stream extraction, DRM bypass, cookie copying or platform-policy workaround.
- Selected source crop: x343, y134, width240, height240; click463,254. The exact crop and click remained unchanged after merging.
- Baseline: Casio / F-91W / Wristwatch, silver, stainless steel; `visible_text: []`; searchable confidence 0.99, identity confidence 0.99.

| Frame | Capture | Evidence result |
| --- | --- | --- |
| Selected 455.0s | Primary frozen crop | Original object and identity retained. |
| Previous 454.5s | Captured through the existing paused player | Compared, but same-object confirmation failed; no contribution accepted. |
| Next 455.5s | Captured through the existing paused player | Same object confirmed. Readable text accepted at 0.95: CASIO, 593, F-91W, STAINLESS STEEL BACK, WATER RESISTANT, MADE IN THAILAND, ED. |

The final provenance reports `frames_used: 3`, `changed_fields: ["visible_text"]`, `field_sources.visible_text: "next"`, capture mode `player` and `restored: true`. All other field sources remain `current`. Both confidence values stay 0.99; extra frames do not inflate them or automatically produce EXACT commerce claims.

Observed seek/presentation sequence: **454.5 → 455.5 → 455.0 seconds**. Every seeking/seeked event reported `paused: true`; no play event occurred. Each target timestamp received a presentation callback. Final timestamp 455.0 and paused state exactly match the starting state.

The derived [manual evidence receipt](../../tests/manual/spike-4e-youtube-evidence.json) contains before/after provenance and playback events. It contains no images, media URLs, cookies or credentials. An initial localization failure was retried using the same click; targeting code was not changed. Dedicated browser processes were closed after the successful verification.

## Final validation and Worker

On 2026-09-14:

- `pnpm check` — PASS.
- `pnpm build` — PASS.
- `node --test apps/api/tests/*.test.mjs apps/extension/tests/*.test.mjs` — **328 passed, 0 failed, 0 skipped**.
- `git diff --check` — PASS.
- Full test log: `/private/tmp/vcl-pr26-activation-tests.log` (local).
- Backend changed, so `cd apps/api && npx wrangler deploy` was run after checks passed.
- Worker: `vcl-api`, `api.vcl.article6.org`.
- Final version: **`d3ba2417-e1a8-46a2-81f2-12e7c85c777a`**, replacing `6c8b69ec-7224-4071-9a31-1803cd19ce69`.
- The successful three-frame run used the final Worker above. No production source changed afterward.

Existing macOS/WXT version warnings did not fail checks, build or deployment. The manual browser used a build with `VCL_DEBUG_PROVENANCE=true`; diagnostics contain derived evidence only.

## Preserved prior work and evidence

This follow-up resumed commit `d11df13` in `/private/tmp/vcl-pr26-acceptance`, branch `spike-4e-multi-frame-evidence`. The primary checkout remains on its separate branch. Local dependency symlinks are not committed.

Previously implemented and preserved: frozen click-centered localization, magnified focus, validated target boxes, click anchors throughout vision comparison, ordinary same-origin detached capture, permitted paused-player capture, cancellation/restoration and user-playback precedence, field-level provenance, conservative merging and provider fallbacks. Earlier committed resolver/Etsy freshness changes remain untouched.

Previously proven results were not repeated:

| Case | Recorded result |
| --- | --- |
| Small object inside a larger salient garment | Clicking the small NOVA wristwatch over the NORTH/STUDIO garment returned Nova / Wristwatch; shirt identity excluded; paused 1.0s. PASS. |
| Large-object control | Clicking the garment returned blue cotton graphic T-shirt, short sleeve, crewneck; paused 1.0s. PASS, with an initial conservative localization failure before retry. |
| Graceful nearby fallback | Hidden-page presentation timeout retained the selected Water Bottle result and confidence and returned 1.0s paused; presentation-based restoration confirmation failed conservatively. |
| Historical detached bottle improvement | Generic bottle gained LUMA / TRAIL 750 from nearby evidence; three frames analyzed, playback paused. |
| Confidence and object preservation | Existing regressions cover repeated agreement without inflation, conflicting categories/identity, capture failure, cancellation and restoration. |

## Limits

This proves one ordinary YouTube case. Fixed coordinates can miss moving objects, hidden/non-presenting pages can time out, and the same-object gate may conservatively reject a usable view (as the previous frame did here). Localization and model confidence remain heuristic. Protected media and failed permitted capture retain their graceful fallback. No universal platform coverage or exact-product precision claim is made.
