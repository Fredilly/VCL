# Spike 4f classification correction

**PASS for the preserved 30-selection static benchmark.** PR #27 remains open and unmerged. This is a bounded regression result, not certification of live model accuracy or exact SKU identification.

## Root cause and general rule

The old gate pooled title/metadata matches and visual attributes into a relevance score. Matching brand plus two construction strings could substitute for a model, and matching guessed model text could substitute for readable identity. Similarity >=0.80 and comparison confidence >=0.85 were enough to promote the resulting score to LIKELY. Generic seam, pocket, or shape agreement could therefore represent product-family resemblance as original-product identity.

The four false LIKELY cases supply similarity 0.88 with agreeing model/family observations; the ten true controls supply 0.96. Their hidden variant truth is unavailable to production. A visual threshold alone separates these particular controls, so the fix also closes the independently reproduced missing-identity pathways, including similarity 1.0 with only title hits or a model guess.

`candidate-verification.ts` now requires all of the following for LIKELY:

- Similarity **>=0.90** and comparison confidence **>=0.90**. These are conservative policy floors, not empirically calibrated probabilities.
- Source brand **and** model observations with `basis: image` and confidence **>=0.85**.
- Literal source model text, and source brand text/logo, agreeing with those observations. Each participating field must have confidence **>=0.85**; legacy descriptions use identity confidence when field confidence is absent.
- Candidate brand/model corroboration at **>=0.85**, from actual provider metadata or candidate-image evidence. Title matches and model-generated metadata that was not supplied by the provider do not qualify.
- Existing subtype agreement, score floor, and no identity/brand contradiction.

Missing identity caps an otherwise eligible candidate at SIMILAR. The existing visual relevance/rejection thresholds, scores, identity keys, sorting, provider routing/priority and retrieval remain unchanged. No EXACT path was added. Generic construction details still contribute relevance but cannot replace the identity requirement. Readable model-free originals may now remain SIMILAR; usefulness is retained, while finer identity evidence is required to call them LIKELY.

## Before and after, same corpus and methodology

Corpus SHA-256: `10b66d88d3d3f5c3392ce2e34308ce27c10eecd4fe86d0c251de9a0a1eea2d4d`.

`corpus.mjs`, candidate truth labels, `metrics.mjs`, and `run.mjs` are unchanged from `891e05d`. The original [FAIL recording](../../tests/benchmark/spike-4f/results/recording.json) remains intact. New [recording](../../tests/benchmark/spike-4f/results/classification-fix/recording.json), [JSON report](../../tests/benchmark/spike-4f/results/classification-fix/report.json), and [human report](../../tests/benchmark/spike-4f/results/classification-fix/report.md) use the same runner.

| Metric | Before | After |
| --- | --- | --- |
| Decision | FAIL | PASS, static evidence gate |
| Likely precision | 71.4% (10/14) | 100% (10/10) |
| False LIKELY | 4 | 0 |
| False EXACT | 0 | 0 |
| Exact precision | N/A, no claims | N/A, no claims |
| Useful-result rate | 80% (24/30) | 80% (24/30) |
| No-result rate | 20% (6/30) | 20% (6/30) |
| P50/P95 local execution | 3.340 / 14.175 ms | 2.728 / 5.798 ms |
| Injected provider failures | 5/82 calls | 5/82 calls |

Only apparel/shoes/watches/bags-accessories `difficult-lookalike` changed, each LIKELY → SIMILAR. Every returned candidate ID, provider provenance, result order, relevance score, and provider call matches the previous run. All ten original-product LIKELY controls and all five contributing multi-frame controls survive. Scoring replay reproduces the new report byte-for-byte. Timings are local fixture execution, not live latency; provider failures are simulated.

## Validation

New regressions failed on the old gate and pass with the correction. They cover moderate similarity despite brand/model agreement; missing/uncertain/non-image source identity; title-only and provider-independent promotion attempts at similarity 1.0; independent catalog/pixel corroboration across arbitrary identities; both confidence floors; and conflicting model evidence. Existing brand-only tests now correctly expect SIMILAR. A positive HTTP-route regression verifies readable model evidence still yields LIKELY through provider normalization and image comparison.

`pnpm check`, `pnpm build`, all **353 tests (0 failed/skipped)**, strict benchmark execution/replay, and Worker deployment dry run passed. No benchmark input or expected classification was changed.

## Deployment and live verification

Deployed backend commit `f70601f` to `vcl-api` / `api.vcl.article6.org`, Worker version **`a7f1dfe5-4eb5-4a22-9a8e-86838fde9785`**. Inspected binding names, production eBay environment and Gemini provider/model settings were preserved. No config or secret changes.

- Repeated singular `bag` metadata request: eBay + Etsy invoked; eight SIMILAR results, no LIKELY/EXACT; 3,407 ms resolver latency. All survivors expose the new readable-identity requirement.
- Existing `adidas-hoodie` catalog-image probe: 72 retrieved, 36 compared, 47 rejected; eight SIMILAR survivors (seven multimodal, one metadata-only), retaining eBay/Etsy provenance. No LIKELY/EXACT, and all survivors expose the new identity requirement. Resolver latency 53,578 ms; total probe 58,423 ms. Comparison coverage was limited by 24 missing images and 12 image-budget omissions; these existing limits were not changed or hidden.

The probe supplies brand/type but no readable source model text, so a familiar logo/title/geometry cannot promote its alternatives. The positive readable-model HTTP regression and all ten preserved true LIKELY benchmark controls establish retention separately. Live probes are operational verification, not a newly scored accuracy corpus. The [derived deployment receipt](../../tests/benchmark/spike-4f/results/classification-fix/deployment-validation.json) stores counts/provenance only, without product listings or image data.

**Merge recommendation:** the unchanged static Spike 4f gate now passes and is ready for review. Keep PR #27 unmerged until reviewed; no automatic merge. Independent real-video calibration and the existing live latency/image-coverage limitations remain outside this bounded passing result.
