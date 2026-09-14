# Spike 4e — Multi-frame evidence acceptance

## Current decision

**FAIL — the required ordinary YouTube multi-frame improvement is not yet proven. Keep PR #26 open and unmerged.**

This supersedes the earlier synthetic-fixture-only PASS. Passing unit tests, successful single-frame YouTube recognition, and the historical bottle improvement do not establish the expanded acceptance gate.

## Work preserved and completed

Work resumed from PR #26 commit `ae9c8e8` on `spike-4e-multi-frame-evidence`, in `/private/tmp/vcl-pr26-acceptance`. The primary checkout was already on `etsy-freshness-fallback-guard`; its work and untracked files were left untouched. Dependency symlinks in the PR worktree are local only.

Already present:

- Explicit improvement action, detached same-origin nearby capture, selected-source binding, bounded API requests, field provenance, Gemini/Groq comparisons and conservative evidence merging.
- Capture/API/merge tests, synthetic bottle/bag/watch/scene-cut fixtures and a CDP browser helper.
- Historical live-Worker bottle success: generic selected frame → LUMA / TRAIL 750 from a nearby frame; three analyzed frames; playback paused. This remains valid historical evidence for the detached path, not proof of YouTube support.
- Earlier resolver/freshness work already committed on the branch.

Added:

- Permitted paused-player capture for readable blob/MSE and cross-origin media, with two bounded seeks (−0.5/+0.5 seconds), presentation synchronization, restoration, cancellation and user-playback precedence. Ordinary same-origin media retains its detached path.
- General click-centered localization using the frozen context crop plus a magnified focus crop. The validated box must contain the click and have confidence at least 0.8. Refined pixels and the click anchor flow through primary and nearby analysis. Ambiguity asks for another selection rather than analyzing the larger surrounding context.
- Whole-visible-object localization for large targets, selection of the video under the click, proportional padding and preservation of source coordinates for neighboring crops. No object-category, brand or benchmark special cases were added to production logic.
- A strict Gemini localization schema and explicit coordinate semantics after a real YouTube call returned invalid geometry. Malformed and off-target boxes still fail validation.
- Category conflict protection for labels outside the canonical taxonomy; repeat agreement cannot raise identity confidence merely because more frames exist.
- Regression coverage for player capture success/failure, stale presentations, DRM/live/playing sources, cancellation/restoration, small-versus-large selection geometry, provider/message contracts and confidence preservation.
- A small-target-in-large-garment fixture, actual MediaSource and blob fixtures, and dedicated-browser targeting/diagnostics. Frames remain transient in memory.

## Automated validation and deployment

Final production source was checked on 2026-09-14:

- `pnpm check` — PASS.
- `pnpm build` — PASS.
- `node --test apps/api/tests/*.test.mjs apps/extension/tests/*.test.mjs` — **326 passed, 0 failed, 0 skipped**.
- `git diff --check` and manual helper syntax check — PASS.
- Backend deployed with `cd apps/api && npx wrangler deploy`.
- Worker: `vcl-api`, `api.vcl.article6.org`.
- Latest deployed version: **`6c8b69ec-7224-4071-9a31-1803cd19ce69`**, created 2026-09-14 08:32:46 UTC; deployment list reconfirmed it at 100% traffic.
- No backend source changed after that deployment; no repeat deployment was needed.

The final test log is `/private/tmp/vcl-pr26-acceptance-tests.log` (local, not committed). The subsequent extension build with `VCL_DEBUG_PROVENANCE=true` only enables derived diagnostics. Existing macOS/WXT version warnings did not fail the checks or deployment.

## Manual evidence

All browser checks used dedicated Chrome for Testing profiles and the real deployed Worker. No vision responses were mocked; no DRM, canvas security or sign-in restrictions were bypassed. Test code generated synthetic media only for the explicitly labeled local fixtures. No captured frame files were retained.

| Case | Observed result | Acceptance meaning |
| --- | --- | --- |
| Small object within larger salient garment | Clicking the small NOVA wristwatch over the large NORTH/STUDIO garment returned **Nova · Wristwatch**, 80% searchable / 70% identity. Refined crop approximately x284.26, y282.65, width59.15, height139.35 in 640×480 source; click314,329. Shirt identity was excluded. Paused at1.0s. | **PASS** for the requested small-object case. |
| Large-object control | Clicking the garment returned **T-shirt**, blue cotton, graphic, short sleeve, crewneck; 85% searchable / 20% identity. Crop432×432; click320,177. Paused at1.0s. Initial localization failed conservatively; a retry succeeded. | **PASS** for the large-object control, with localization reliability limitation recorded. |
| Ordinary YouTube selected-frame targeting | [Casio F91W unboxing](https://www.youtube.com/watch?v=IpQd3XH0_EQ), paused18.45s: initial locator returned invalid geometry; after the schema fix, the extension returned **Casio · F-91W · Digital Watch**, with LIKELY commerce results. The final bounded check at455.0s also returned Casio · F-91W · Wristwatch, 99% searchable / 99% identity from the primary frame alone, and remained paused at455.0s. The incomplete-result improvement action was not offered. Other already-tested views likewise produced complete primary identity. Readable blob/MSE source, no mediaKeys. | **PASS for single-frame targeting only.** These complete primary results did not expose the incomplete-result improvement action and do not prove multi-frame acceptance. |
| Actual MediaSource fixture fallback | The new player path was reached. Presentation waits timed out while Chrome reported the page hidden; nearby pixels were discarded, selected Water Bottle result and confidence retained. The player returned to1.0s paused, although presentation-based restoration confirmation failed. | **PASS for observed graceful fallback. Not a successful capture/improvement.** |
| Ordinary YouTube nearby evidence | No verified run yet establishes selected-plus-neighbor capture, useful accepted additional evidence and restored playback together. | **UNPROVEN; overall acceptance FAIL.** |

The small/large fixture successes preceded the final schema tightening; the final adapter and geometry regressions passed afterward. They were not needlessly repeated. YouTube single-frame schema recovery used the latest Worker. The historical LUMA bottle improvement remains recorded separately above.

## Remaining gate and limits

Only the real YouTube multi-frame gate remains unproven: use an incomplete selected object on the existing permitted video, activate improvement through the extension, record at least one captured neighbor and an accepted useful contribution for that same object, and verify the exact selected timestamp remains paused. Inspect provenance and commerce labels to ensure confidence was not raised by frame count alone.

Do not merge based on the synthetic proof or 326 passing tests. Fixed crop coordinates can lose a moving object. Hidden or non-presenting pages can time out conservatively. Localization and same-object judgments remain model dependent and may reject useful evidence. Protected media, unavailable seeks, changed playback and unreadable pixels retain the selected-frame fallback. No stream extraction, protected rendering patch, cookie copying or alternative capture bypass is implemented.

## Final handoff

The final bounded retry reused the same YouTube video; no additional videos were searched. No production code changed after the passing 326-test run and latest deployment. Documentation and the browser helper were checked separately. The dedicated test browsers and fixture server were stopped before handoff. PR #26 remains open and unmerged; this report intentionally does not claim the remaining YouTube gate passed.
