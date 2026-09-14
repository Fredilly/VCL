# Spike 4f exact-match benchmark

**FAIL for identification calibration; benchmark implementation complete.** The exact-claim safety gate passes with zero EXACT outputs, but exact precision remains unmeasurable. Four deliberately misleading lookalikes are LIKELY despite the conservative SIMILAR expectation. No classification threshold, verification score, or commerce ordering was changed to improve the result.

The [benchmark README](../tests/benchmark/spike-4f/README.md) defines the protocol and commands. [Machine-readable results](../tests/benchmark/spike-4f/results/report.json), the [per-selection report](../tests/benchmark/spike-4f/results/report.md), and the [pre-fix baseline](../tests/benchmark/spike-4f/results/baseline/report.json) are committed.

## Measured static results

30 selections: apparel 6, shoes 6, watches 6, bags/accessories 6, other 6. Twenty fixture-known identities, ten unknown identities, ten named product models across nine brands, and five contributing multi-frame cases. Every category includes known-original, difficult lookalike, low-evidence, multi-frame, modeled unavailable/vintage, and no-result controls.

| Metric | Before routing fix | Final |
| --- | --- | --- |
| Exact precision | N/A, no claims | N/A, no claims |
| Likely precision | 83.3% (10/12) | 71.4% (10/14) |
| False-exact rate | 0% (0/30) | 0% (0/30) |
| Useful-result rate | 73.3% (22/30) | 80% (24/30) |
| No-result rate | 26.7% (8/30) | 20% (6/30) |
| P50 / P95 local latency | 3.016 / 12.699 ms | 3.340 / 14.175 ms |
| Injected provider-call failure rate | 6.6% (5/76) | 6.1% (5/82) |

These are authored evidence fixtures executed through production resolver/merger code, not live model predictions. The fixtures label their known originals independently of pipeline output. Hidden lookalike identity and wrongly agreeing model evidence are intentionally injected; 71.4% is not a measured Gemini/video accuracy estimate. Local timings do not establish the 3s/6s live resolution targets. Provider failures are simulated.

## Findings and scoped fix

The first measurement exposed that singular/product-type categories (`watch`, `bag`, `sneakers`, `boots`) could exclude Etsy even though their normalized categories were supported. Four focused tests failed before the fix. `isEtsyEligible` now reuses the existing verification category normalizer; all four pass, and three unrelated-category exclusions remain intact. No provider was added and no commerce ranking changed.

Recovering provider eligibility exposed two more false LIKELY lookalikes and therefore **lowered** measured precision while improving usefulness. Both measurements remain available. The four false LIKELY selections are apparel, shoes, watches, and bags/accessories `difficult-lookalike`. Agreement on reported family/geometry is vulnerable to an erroneous upstream identity observation. The static data cannot justify a general new image threshold or product-specific exception, so that uncertainty remains a reported failure.

Five intentionally wrong-color controls correctly return no result. The sixth no-result is the other-category lookalike with only an ineligible provider. Missing image evidence preserves useful metadata-only SIMILAR alternatives. All five requested nearby cases accept the next-frame identity clue and reject the previous frame's different-object evidence; none generates EXACT.

## Video evidence, separately

The [five-case validation subset](../tests/benchmark/spike-4f/video-validation.json) reuses Spike 4e acceptance artifacts: one real YouTube watch case and four local synthetic cases. It proves prior capture/evidence behavior only. No new live-video accuracy or P50/P95 measurement is claimed, and these cases are excluded from static metrics. No video corpus or third-party imagery was archived.

## Verification and deployment

`pnpm check`, `pnpm build`, **347 tests (0 failed/skipped)**, deterministic scoring replay, repeated offline semantic execution, and Worker packaging passed before deployment. Deployment is required only because of the scoped category-normalization backend fix. The Workers/Wrangler skill checks retained the existing compatibility target and dashboard-managed bindings; no configuration or secret change was needed.

Deployed code: `d476e84`; Worker `vcl-api` at `api.vcl.article6.org`; version **`19cb1c02-b062-4ce7-8aa7-15961c96a674`**. Deployment preserved the inspected binding names, `EBAY_ENVIRONMENT=production`, and the Gemini provider/model settings. Existing WXT missing-version and macOS/Wrangler warnings did not fail validation.

One fresh metadata-only `bag` request verified the deployed routing fix: eBay and Etsy were invoked, eight eBay-provenance SIMILAR results returned, and Brave/SerpAPI were skipped as upstream sufficient. Resolver latency was 3,955 ms. This smoke request used no image and is neither a video case nor part of the static metrics; it proves provider invocation, not Etsy survivor quality or primary-provider reliability. See the [deployment receipt](../tests/benchmark/spike-4f/deployment-validation.json).

The Spike 4f PR remains unmerged. Further product work should address independent identity evidence/calibration before claiming exact-match capability.
