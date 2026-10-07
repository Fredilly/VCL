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


## Repeatable partner-roster path

The production path accepts multi-product verified mappings through the existing
`VERIFIED_PRODUCT_MAPPINGS_JSON` registry. The same generic roster builder used
by alpha seeds converts those mappings into canonical same-video candidates.

For each request:
1. match platform + content,
2. optionally narrow by `candidate_window_start_ms/end_ms`,
3. hydrate missing product imagery from the verified destination when possible,
4. compare the selected video pixels against the bounded roster,
5. run the normal contradiction/visual verifier,
6. return Exact only when earned; otherwise continue to Similar/Related/NONE.

Candidate windows are priors, never truth. A wrong creator/partner roster item
must still be rejectable. The frozen gate now includes partner-family confusion
cases modeled on a floral Neverfull vs plain Neverfull and Trunkie vs Petite
Malle. No brand- or SKU-specific resolver exceptions are allowed.

## General catalog reliability (version 2)

The 28 frozen evidence cases remain unchanged. CI now also runs every cyclic
candidate order and reversal against the production resolver. That gate must
have zero false Exact, perfect existing SKU/NONE/ambiguity outcomes and no
order-dependent identity. Repeated permutations are not independent quality
samples. `pnpm benchmark:outliers:order NEW-report.json` saves this evidence.

`pnpm benchmark:outliers:chaos manifest-v2.json adapter.mjs NEW-report.json`
adds a stricter **real-pixel** protocol for arbitrary SKU rosters. Version 1
replay remains available for historical comparisons. Version 2 requires:

- Independent, reviewed SKU labels and explicit empty/ambiguous cases.
- Frozen source **and catalog reference** bytes, checked before inference.
- Development/holdout splits with no shared source group, catalog, or exact
  source image hash. Related crops/frames must share a source group; hash checks
  cannot detect every near-duplicate. Use a reviewer independent of model output.
- At least three held-out catalogs and three categories; two independent source
  groups per catalog. No generalization claim from a single luxury bag video.
- Each catalog, category and roster-size slice (1, 2–16, 17–64, 65+) has at least
  five positive, five outside-roster and two ambiguous observations. Also test
  an empty roster. These are provisional minimums, not statistical proof.
- Every scenario in `chaosScenarios`: clean, family lookalikes, visible variants,
  unobservable variants, mixed categories, multiple objects, misleading text,
  wrong roster, missing references, duplicate offers, stale memory, scene cuts,
  occlusion, and outside-roster selections.

A representative case (hash strings below are placeholders, not runnable data):

```json
{
  "version": 2,
  "cases": [{
    "id": "internal-case-id",
    "scenario": "family_lookalike",
    "truth": "IN_ROSTER",
    "expected_class": "catalog:sku-a",
    "catalog_id": "heldout-catalog-1",
    "source_group": "independent-video-1",
    "category": "bags",
    "split": "holdout",
    "reviewed_by": "reviewer-id",
    "roster": [{
      "canonical_key": "catalog:sku-a",
      "title": "Catalog title",
      "attributes": {"brand": "Brand", "size": "Small"},
      "offers": [{"merchant": "Merchant", "title": "Listing title"}],
      "references": [{"path": "catalog/a.png", "sha256": "64 lowercase hex characters"}]
    }],
    "input": {
      "click": {"x": 0.5, "y": 0.5},
      "context": {"video_title": "Original title", "spoken_text": "Original speech"},
      "frames": [{"path": "frames/selected.png", "sha256": "64 lowercase hex characters", "timestamp_ms": 4500}]
    }
  }]
}
```

Use separate canonical keys for distinct SKUs. Group multiple merchant offers
under a single SKU. A family label cannot substitute for variant truth. If the
clicked image cannot distinguish size/edition and no reliable selected-object
evidence establishes it, label AMBIGUOUS, even if a reviewer knows the SKU.
`references: []` explicitly represents unavailable reference imagery. Never
fabricate comparisons or use merchant titles as ground truth. Wrong family
names and nearby labels belong in input evidence when actually observed.

Adapters export `predict(input, {signal})`, honoring cancellation. Input includes
image bytes, click, allowlisted context/catalog fields and NONE/UNKNOWN; it
excludes case IDs, scenario, split, reviewer, expected answers and file paths.
Use a stateless request or reset case-specific caches between calls. Exercise
production retrieval, verification and resolution, including its bounded
candidate shortlist. Do not return the full supplied roster as a fabricated
retrieval trace. Catalog keys/titles themselves must not encode evaluation truth.

Successful output:

```js
return {
  status: 'OK', predicted_class: 'catalog:sku-a', result_class: 'EXACT',
  retrieved_keys: ['catalog:sku-b', 'catalog:sku-a'], // actual pre-verification order
  verified_keys: ['catalog:sku-b', 'catalog:sku-a'], // actually verified candidates
  provider_calls: 2, cost_usd: 0.002 // measured example shape, not a cost estimate
};
```

Use NONE/UNKNOWN with a null class, or explicit PROVIDER_BLOCKED/SYSTEM_FAIL.
Invalid traces count as SYSTEM_FAIL. Exact requires the key to appear in both
retrieval and verification traces. Trace validation establishes consistency,
not honesty; review the adapter and record its production revision, provider,
model and settings alongside the run. The report pins manifest and adapter-file
hashes; the adapter hash alone does not pin imported dependencies.

The report separates recall@1/@5 and reciprocal rank from final SKU accuracy,
Exact precision, NONE recall and ambiguity abstention. It identifies retrieval
misses versus verification/ranking misses, reports per-catalog/category/size
slices, and measures wall time, provider calls and cost. The runner executes up
to three unique roster orders, including answer-space order. Any inconsistent
identity or class fails. Timeout aborts the run and prevents further calls;
provider adapters must enforce their own per-request spending bounds. Up to
three orders means up to three times the replay cost. No live inference in CI.

Promotion requires zero false Exact across all cases/orders, >=95% aggregate
and per-slice accuracy and NONE recall, >=95% recall@5, full ambiguity abstention,
complete coverage, no provider/system failures, and no failing scenario. At
least 60 independent baseline Exact observations are required; permutations
never inflate that count. The zero-error 95% upper bound is reported under an
independent-trials assumption, which correlated frames violate. Even 60 correct
Exact observations only bound error near 4.9%, not zero production risk.

**Current evidence status:** no reviewed multi-catalog real-pixel corpus or
production end-to-end adapter is bundled. Version 2 cannot honestly report a
promotion pass yet. Synthetic tests exercise the evaluator's failure detection;
they are not recognition benchmarks. Existing CI success certifies deterministic
policy behavior only. Freeze reviewed captures and reference images in approved
private storage, connect a production adapter, and run both this protocol and
Golden before claiming broader retrieval reliability. Harness-only changes do
not change production recognition, model thresholds or the original fixtures.
