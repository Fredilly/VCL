# Spike 4f: exact-match benchmark

The main suite is **30 static resolver selections**, six each in apparel, shoes, watches, bags/accessories, and other products. It contains 20 fixture-known identities and 10 unknown identities, with five multi-frame cases. Ten named product models span nine brands. Model/color identity is the evaluation unit; no authentication or serial-number claim is made.

## Run

```sh
pnpm benchmark
pnpm benchmark:replay
pnpm test
```

The first command compiles and executes the current production resolver, verification/ranking gate, and nearby-frame merger using authored provider and image-comparison evidence. It needs no network, browser, credentials, or paid provider. It writes `local/report.json`, `local/report.md`, and `local/recording.json`. Injected provider errors on stderr are expected. Failures are included in the dataset.

The second command recalculates the committed recording's metrics without calling providers. Reports reproduce byte-for-byte. A fresh static execution reproduces decisions; measured local timings naturally vary. `provenance.pipeline_source_sha256` identifies all API TypeScript source independently of the enclosing git revision, including uncommitted changes when the recording was made.

```sh
# Publish a new measured snapshot intentionally:
node tests/benchmark/spike-4f/run.mjs static --output tests/benchmark/spike-4f/results
# Re-score the preserved pre-fix baseline:
node tests/benchmark/spike-4f/run.mjs replay --input tests/benchmark/spike-4f/results/baseline/recording.json
# Use a nonzero exit code when the scientific decision is FAIL:
node tests/benchmark/spike-4f/run.mjs replay --strict
```

Normal execution returns success if it produced a valid report, even if the benchmark's scientific decision is FAIL. `--strict` is the quality-gate mode. Test failures and malformed/stale records always fail the command.

## What the evidence means

`corpus.mjs` holds the fixture definitions. Each selection separates `input` from `ground_truth`, `expected_classification`, and candidate `labels`. Only `input` enters the production pipeline. The labels predate execution; the returned rank, title match, provider, and production identity key never decide correctness. Every returned candidate requires an adjudication, and reviews bind to the exact observation hash.

The known-original controls deliberately expect **LIKELY**: knowing the answer in the fixture does not supply the production pipeline with independent SKU proof. Difficult controls inject a lookalike with falsely agreeing model-family evidence; the oracle knows it is a different product. These test sensitivity to erroneous upstream identity evidence, **not the frequency of such errors in real image models**. The conservative expected ceiling is SIMILAR. Their failure is a reason to collect better independent evidence, not to tune thresholds against the fixture's hidden answer.

Unavailable/vintage means the original is absent from the **modeled inventory**. No live availability is asserted. Images, inventory, replacement names, prices, and provider IDs are synthetic. Manufacturer links identify named product references only; no provider catalog, Etsy listing data, or third-party images are archived. The final other-category lookalike has only an ineligible Etsy provider; its no-result exposes the configured coverage limit rather than a classification error.

Existing evidence reused:

| Existing asset | Inventory | Use |
| --- | --- | --- |
| Spike 4d apparel benchmark | 140 evidence cases / 12 apparel families | Comparable-evidence and contradiction patterns |
| `live-apparel.mjs` | 5 catalog probes, 3 with explicit product/model codes | Adidas and Patagonia product references |
| `ebay-search.json` | 1 mocked Nike Air Max 90 item | Provider normalization shape and named-model control |
| Spike 4e YouTube receipt | 1 real video case | Separate historical capture/evidence validation |
| Spike 4e local video page | 5 synthetic scenes | Nearby logo, scene-cut, and object-preservation controls |

Additional manufacturer references for the static controls: [Samba B75806](https://www.adidas.com/us/samba-og-shoes/B75806.html), [Casio F-91W-1](https://www.casio.com/us/watches/casio/product.F-91W-1/), [Kanken](https://www.fjallraven.com/us/en-us/bags-gear/kanken/kanken-bags/kanken/), and [Type 75](https://www.anglepoise.com/usa/product/type-75-desk-lamp-jet-black/). Vintage controls with no independent source are explicitly fixture-label ground truth, not externally verified video identifications.

## Metrics and decision

- Exact/likely precision: correct, adjudicated **top** predictions divided by adjudicated top predictions in that class. Unknown identities stay outside the denominator and are separately counted. Zero claims => `null` / N/A.
- False-exact rate: selections containing **any** adjudicated false EXACT, at any returned rank, divided by all selections. Unverified EXACT on unknown identities is surfaced separately and fails the trust gate.
- Useful-result rate: selections with any oracle-labeled useful returned candidate / all selections. A useful SIMILAR alternative does not count as identifying the original.
- No-result rate: selections with zero returned products / all selections. `NO_RESULTS`, `TEMPORARILY_UNAVAILABLE`, and request failures remain distinct in row state.
- P50/P95: nearest-rank percentiles of all local execution durations, including failures. These are **not live network, model, browser, or Worker timings**.
- Provider failure rate: failed observable provider calls / all observable provider calls. Static failures are injected; real provider reliability cannot be inferred.

The static gate requires no false/unverified EXACT, at least 70% usefulness (existing project target), no runner/request failures, and no classification above the fixture's conservative expected ceiling. Lower-confidence correct results are allowed. Every failed/unknown claim remains visible in JSON and the human report. No exact-coverage minimum encourages invented EXACT claims.

Repeated scenarios and product families are correlated. No statistical population confidence or production accuracy claim is supported by 30 authored controls. `results/baseline/` preserves the first measurement before the general routing fix; `results/` holds the final measurement. The benchmark fails honestly if lookalike calibration remains weak.

## Separate video validation

`video-validation.json` reuses five existing acceptance cases: **one public YouTube case and four local synthetic cases**. None contributes to static accuracy or latency metrics. Its receipts validate capture, target preservation, and nearby evidence delivery, not commerce precision. No new live-video run is claimed. The previous acceptance page and instructions remain available for a bounded manual rerun; a browser is never required for the main benchmark.
