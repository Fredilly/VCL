# Offline video-to-SKU mapper (experimental)

This is a **reviewable mapping pipeline**, not a product identity oracle. It supports local, permitted frame captures from one video and reference images from the SKU list. It deliberately cannot mark anything VERIFIED automatically.

## Input

A JSON manifest contains `video.source`, `catalog[]` entries with `sku`, `title`, and `images[]` ({`path`, `sha256`}), plus timestamp-ordered `frames[]` ({`timestamp_ms`, `path`, `sha256`}). Paths are relative to the manifest. Images are immutable and SHA-256 checked.

Only local PNG/JPEG/WebP evidence is loaded. The operator must obtain video frames lawfully, without bypassing protected content. No video URLs are scraped, no private HAR is exported, and no raw frames enter permanent production storage.

## Vision adapter contract

Implement a local `predict({frame,catalog})` export returning `{candidates:[{sku,similarity,visual_compared,contradiction}]}`. The adapter must actually compare selected frame pixels to SKU reference images and supply calibrated [0,1] similarity. It must not read any ground truth/labels. A stub that supplies guessed scores is not an accuracy test.

Run:

```bash
node tools/offline-video-sku-map.mjs path/to/manifest.json path/to/vision-adapter.mjs private-report.json
node --test tests/benchmark/offline-video-sku-map.test.mjs
```

Outputs candidate windows with provenance and `NEEDS_HUMAN_REVIEW` or `UNKNOWN`. At least two independent frames, strong visual agreement, an adequate gap from siblings, and no explicit contradiction are needed even to request review. Human review is required before creating verified assertions. Offline proposal thresholds are **not** production EXACT thresholds.

## Acceptance before deployment

Supply real frame evidence, real SKU images, and a model-backed adapter, then freeze separately reviewed labels before scoring. Measure in-roster top-1, out-of-roster NONE recall, sibling confusion, false EXACT, image coverage, latency and cost. Report missing input explicitly. Do not equate an unlabeled HAR replay with accuracy, or re-label a failed fixture to pass.

This script is the deterministic timeline/review stage. **It does not yet download the YouTube video, create frames, hydrate the original ten-SKU catalog, or implement model inference.** Those inputs must be wired and verified before an end-to-end success claim is possible.
