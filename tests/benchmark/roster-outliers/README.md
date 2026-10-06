# Open-set roster outlier harness

Creator contract: **video + optional product roster**. Timestamps, negative
examples, regions and evaluation labels are Scoop engineering responsibilities.
A roster supplies candidates, never proof that every selected object is in it.

## Two test layers

`pnpm benchmark:outliers` runs 26 frozen **evidence-level** cases through the
shipped same-video reuse functions. The normal `pnpm test` command enforces
these cases in CI. Coverage includes all 19 scenario groups in `corpus.mjs`,
A/B/C/D/NONE, X/NOT X, and white Alma versus Pochette. No paid inference.

These fixtures supply descriptions and image-comparison outputs. They measure
resolver behavior, **not** real OCR, image understanding, localization, tracking,
or performance on transformed pixels. A passing evidence suite is insufficient
to promote vision/tracking changes. Do not invent source footage or labels.

`pnpm benchmark:outliers:replay manifest.json adapter.mjs NEW-report.json`
provides a separate frame-to-answer adapter harness. It verifies frozen frame
SHA-256 hashes, uses saved clicks, hides ground truth/scenario names from the
adapter, bounds each call to 30 seconds and writes immutable reports. The
adapter must honor cancellation and distinguish provider blocking from NONE.
A real model adapter and a reviewed, permissioned frame corpus still need to be
connected; this change does not claim a completed real-video benchmark.

## Truth and output

| Ground truth | Required outcome |
| --- | --- |
| IN_ROSTER | Correct canonical SKU |
| OUT_OF_ROSTER | NONE |
| AMBIGUOUS | UNKNOWN or conservative abstention; never Exact |

The answer space always includes NONE and UNKNOWN, including one-SKU videos.
UNKNOWN means insufficient evidence; it does not count as successful NONE
detection. The legacy evidence resolver exposes only a null decision, so its
abstentions are mapped to NONE and are reported separately by truth label.
NONE precision includes ambiguous abstentions in its denominator.

Any wrong Exact fails, including **B returned for known A**, not only a SKU
forced onto an outside-roster item. Frozen evidence gates require all cases
correct, NONE recall 1, ambiguity abstention 1, and zero false Exact. The frame
promotion defaults are provisional: top-1 >= .95, NONE recall >= .95, ambiguity
abstention 1, zero false Exact, complete scenario coverage, and no blocked or
broken cases. Always-NONE and empty corpora fail. Report per-scenario results
so easy examples cannot hide failures. Zero observed false Exact is a finite
benchmark result, not proof of zero production risk.

## Frame manifest and adapter contract

```json
{
  "version": 1,
  "cases": [{
    "id": "stable-internal-case-id",
    "scenario": "single_sku",
    "truth": "IN_ROSTER",
    "expected_class": "catalog:sku-x",
    "roster": [{"canonical_key": "catalog:sku-x", "title": "Catalog product"}],
    "input": {
      "click": {"x": 0.5, "y": 0.5},
      "context": {},
      "frames": [{"path": "frames/selected.png", "sha256": "64 lowercase hex characters", "timestamp_ms": 4500}]
    }
  }]
}
```

Adapters export `async predict(input, { signal })` and return
`{status: 'OK', predicted_class: 'catalog:sku-x', result_class: 'EXACT'}`.
For abstention use `NONE`/`UNKNOWN` and `result_class: null`. For failure return
`PROVIDER_BLOCKED` or `SYSTEM_FAIL`. Frames contain bytes and timestamps;
roster/context are input evidence only. Do not smuggle labels into context,
filenames, metadata or catalog fields. Evaluate the clicked visible object,
not a nearby SKU label or the narrated product. Nearby frames must preserve
object identity across cuts and overlapping accessories.

Keep ground truth at variant/SKU granularity. Independently review labels;
creator roster errors are adversarial inputs, never ground truth. Add real
positive and negative examples for every scenario, multiple categories and
held-out videos. Freeze reviewed cases before evaluating. Never edit labels,
comparisons or thresholds to make a regression pass.

## Failure and fix evidence

The immutable initial run catches `nearby-ocr-wrong-item`: the distinctive text
shortcut returned Exact before image comparison. The visual-veto run keeps the
same frozen fixture and thresholds and passes all 26 cases with false Exact 0.
Production same-video reuse now waits for visual verification; rejection or
unavailable image evidence cannot inherit an OCR/model Exact. The benchmark
adapter forwards recorded comparisons to the same resolver, without changing
evaluation labels, comparisons, or scoring. Evidence-only cases without recorded
comparisons retain their existing legacy evaluation path.

Live Golden regression remains blocked in this workspace by missing provider
credentials and saved frames. Its immutable blocked record is under
`tests/golden/runs/`. Passing deterministic gates is not live Golden evidence.
Additional image verification may increase provider calls, cost and latency;
those effects require a live controlled run before production promotion.
