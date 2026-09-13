# Spike 4e — Multi-frame evidence

## Scope and acceptance gate

The gate in `02_MVP_SCOPE_AND_SPIKES.md` requires user-initiated, permitted nearby-frame capture that materially improves incomplete identification. This spike uses one selected crop and at most two additional crops at −0.5 and +0.5 seconds. It does not continuously scan video.

An explicit **Improve with nearby frames** action is offered for incomplete descriptions. A detached, paused decoder reads ordinary same-origin HTTP(S) media at the original crop coordinates. It never seeks, plays, or pauses the user's player. Protected media, cross-origin sources, blob/MSE media, live streams, unavailable seeks, blank crops and duplicates degrade to the selected-frame result. Closing the result or pressing Escape cancels further capture.

Gemini and Groq compare each neighbor against the primary crop. A neighbor must support the same physical object, and descriptive fields must have strong direct evidence before contributing. Strong primary evidence survives unknown, weak and conflicting observations. Brand/model claims require visible text or markings; conflicting brands, categories, sleeves and necklines are guarded. Queries are rebuilt from accepted evidence, without adopting rejected neighboring search terms. Additional frames do not automatically produce an `EXACT` commerce classification.

The API preserves the legacy single-frame request, bounds the actual request body and individual image sizes, validates nearby slots and timestamps, and returns field-level provenance without frame bytes. Failed nearby model calls preserve the primary result. Frame crops remain transient in extension/API memory; responses use `Cache-Control: no-store`. Provenance UI is enabled only by `VCL_DEBUG_PROVENANCE=true`.

## Work resumed

Starting branch: `etsy-freshness-fallback-guard`, commit `619be6f`, with an existing open PR #25. Work continued in place on `spike-4e-multi-frame-evidence`; no existing changes were discarded.

Already present in the working tree:

- Nearby capture module, source binding, explicit improvement UI and background message forwarding.
- Gemini/Groq comparison prompts, field confidence, evidence merger, API request validation and response provenance.
- Multi-frame unit/API/capture tests and in-memory bottle, bag and watch fixtures with a CDP helper.
- Etsy live-fetch freshness correction and partial resolver fallback changes.
- The reported earlier bottle success: generic baseline → LUMA / TRAIL 750, three analyzed frames, playback paused.

Added during resumption:

- Repaired duplicate declarations and dangling resolver variables; completed fallback sufficiency checks using verified accepted candidates, including skip telemetry before early return.
- Regression coverage proving three rejected candidates from either the primary or Brave tier cannot suppress later fallbacks.
- Scene-cut and blob-source fixtures; explicit browser port selection, service-worker wake-up and VCL target selection; compact derived-evidence output.
- Wrangler build artifacts excluded from Git and this acceptance/evidence record.

The pre-existing empty `created_timestamp` and `updated_timestamp` files were left untouched and are not part of the implementation commit. The inherited Etsy work is preserved: listing creation/update age is distinct from when the listing was fetched live.

## Validation

On 2026-09-14 (Asia/Shanghai):

- `pnpm check` — passed.
- `pnpm build` — passed.
- `node --test apps/api/tests/*.test.mjs apps/extension/tests/*.test.mjs` — 310 passed, zero failed/skipped.
- `npx wrangler deploy --dry-run` — passed.
- `cd apps/api && npx wrangler deploy` — deployed `vcl-api` to `api.vcl.article6.org` and `vcl-api.fredilly.workers.dev`.
- Final Worker version: `6c9982f1-84a4-4606-8aa4-834df12759bb`.

Existing tool warnings: extension version defaults to `0.0.0`; local macOS 12.6 is below Wrangler's recommended runtime version. Build and remote deployment succeeded.

## Manual browser verification

Controlled synthetic media was generated and served in memory by `tests/manual/multi-frame-server.mjs`. The built extension called the live deployed Worker; neither model results nor API requests were mocked. These are evidence-merging checks, not a real-product retrieval or exact-match benchmark.

Use a dedicated Chrome for Testing profile with the unpacked extension at `apps/extension/.output/chrome-mv3` and remote debugging enabled. Build with `VCL_DEBUG_PROVENANCE=true pnpm --filter @vcl/extension build` to see provenance. Start `node tests/manual/multi-frame-server.mjs`, visit `http://127.0.0.1:8799/`, select a case, invoke VCL, click the object, widen twice, Analyze, then Improve with nearby frames. The CDP helper accepts `--port PORT`; `wake EXTENSION_ID` starts an idle extension worker before `invoke`. `result` prints only derived evidence and playback state.

The following browser checks used the final Worker version above. Each selected frame was at 1.0 seconds; each permitted nearby pair was at 0.5 and 1.5 seconds.

| Case | Single frame | Nearby result | Frames analyzed | Playback |
| --- | --- | --- | ---: | --- |
| Bottle label | Generic blue Water Bottle; no identity | Next-frame `LUMA / TRAIL 750` accepted as brand/model/text. Previous comparison was not confirmed as the same object. Strong primary color/material preserved. | 3 | Paused at 1.0s |
| Bag clasp/label | Generic brown leather Briefcase; no identity | `ARBOR / FIELD 20` read in both neighbors, but neither passed same-object gating. Baseline preserved; no hypothesis change. | 3 | Paused at 1.0s |
| Watch face | Generic Wristwatch; no identity | `NOVA / FIELD 24` read in both neighbors, but neither passed same-object gating. Baseline preserved; no hypothesis change. | 3 | Paused at 1.0s |
| Scene cut | Generic blue Water Bottle | Neighboring NOVA watch rejected as an unconfirmed object match. No watch identity entered the bottle hypothesis. | 3 | Paused at 1.0s |
| Blob fallback | Generic blue Water Bottle | Explicit improvement action reported nearby frames unavailable and retained the selected-frame result. | 1 | Paused at 1.0s |

The earlier successful bottle result was reproduced. One of the three positive-detail fixtures materially improved identification in this run. Bag and watch illustrate conservative missed improvements, not successful identity resolution. The scene-cut negative control preserved the selected object.

Decision: **PASS for the bounded, user-initiated capture and conservative merge proof.** Retain the explicit opt-in and permitted-source restrictions. Broader multi-category improvement is not established by these fixtures and needs real-video evaluation before expanding scope.

## Limits

This deliberately does not provide nearby capture for YouTube blob/MSE or protected video; those retain the selected-frame fallback. Fixed crop coordinates can miss moving objects, and the same-object gate can conservatively reject a usable neighboring view. Model confidence remains heuristic. These controlled fixtures establish the capture/merge behavior, not exact-product precision, merchant availability, latency targets or production video coverage.
